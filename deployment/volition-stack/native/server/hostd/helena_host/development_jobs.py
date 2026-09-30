"""Typed development jobs; commands and paths are derived here, never from shell input."""
from __future__ import annotations

import fcntl
import json
import os
import pwd
import re
import subprocess
import sys
import signal
import shlex
import uuid
from contextlib import contextmanager

from . import audit, development, privileged
from .common import HostError, atomic_write_json, iso, json_load_file

SHA = re.compile(r'^[a-f0-9]{40}$')
BRANCH = re.compile(r'^hub/[a-z0-9][a-z0-9-]{0,63}$')
OPERATIONS = ('worktree', 'merge', 'review', 'gate', 'tests', 'build', 'probe', 'deploy', 'verify')
LIVE = '/srv/volition/source/plan'
NATIVE = LIVE + '/deployment/volition-stack/native'


def paths(ctx):
    work = development.work_path(ctx)
    repo = ctx.config.data.get('development', {}).get('repo', os.path.dirname(work) + '/volition/plan')
    with development.directory(work), development.directory(repo):
        return work, repo


def job_path(ctx, ident):
    if not privileged.ID.fullmatch(ident):
        raise HostError('InvalidParameter', 'Invalid development job id')
    root = os.path.join(ctx.config.state_dir, 'volition-development')
    os.makedirs(root, mode=0o700, exist_ok=True)
    with development.directory(root):
        return os.path.join(root, ident + '.json')


def result(ctx, params):
    value = json_load_file(job_path(ctx, params['id']))
    if value is None:
        raise HostError('NotFound', 'Development job not found')
    state = privileged.state(ctx.config)
    if not value.get('dryRun') and value['status'] in ('pending', 'running') and (not state['enabled'] or state['epoch'] != value['epoch']):
        value.update(status='revoked', finishedAt=iso(ctx.host.now()), output='Root access was revoked', exitCode=1)
        atomic_write_json(job_path(ctx, params['id']), value)
    return {key: value[key] for key in ('id', 'operation', 'branch', 'expected', 'status', 'steps', 'output', 'exitCode', 'createdAt', 'finishedAt')}


def command(ctx, argv, timeout=30, **kwargs):
    value = ctx.host.run(argv, timeout=timeout, output_limit=65536, **kwargs)
    if value.returncode:
        raise HostError('CommandFailed', 'Development command failed', exitCode=value.returncode)
    return value.stdout.strip()


def owner(ctx, argv):
    work, _ = paths(ctx)
    account = pwd.getpwuid(os.stat(work).st_uid)
    return ['runuser', '-u', account.pw_name, '--', 'env', 'HOME=' + account.pw_dir,
            'TMPDIR=' + work + '/tmp', *argv]


def commit(ctx, branch, expected):
    _, repo = paths(ctx)
    actual = command(ctx, ['git', '-C', repo, 'rev-parse', '--verify', branch + '^{commit}'], 5)
    if actual != expected:
        raise HostError('Busy', 'Branch differs from the expected full commit')


def evidence(ctx, operation, expected):
    root = os.path.dirname(job_path(ctx, '0' * 32))
    for name in os.listdir(root):
        if not re.fullmatch(r'[a-f0-9]{32}\.json', name):
            continue
        value = json_load_file(os.path.join(root, name), {})
        if value.get('operation') == operation and value.get('expected') == expected and value.get('status') == 'success' and not value.get('dryRun'):
            return value
    raise HostError('NotAllowed', 'Missing successful ' + operation + ' for this commit')


def plan(ctx, params):
    work, repo = paths(ctx)
    op, sha, branch = params['operation'], params['expected'], params['branch']
    artifact = work + '/tmp/volition-artifacts/' + sha
    commands = {
        'worktree': ['git', '-C', repo, 'worktree', 'add', '-b', params.get('target', ''), work + '/tmp/' + params.get('name', ''), sha],
        'merge': ['git', '-C', repo, 'merge-tree', '--write-tree', branch, params.get('target', '')],
        'gate': ['flock', '-n', work + '/.volition-full-test.lock', work + '/full-test.sh', sha],
        'tests': [work + '/heavy.sh', 'bun', 'test', *params.get('testFiles', [])],
        'build': [work + '/heavy.sh', 'python3', NATIVE + '/web-artifact.py', 'build', '--repo', repo, '--commit', sha, '--out', artifact, '--offline'],
        'probe': ['node', artifact + '/standalone/apps/web/server.js'],
        'deploy': [NATIVE + '/deploy.sh', '--expect', sha, '--web-artifact', artifact, '--wait-inflight', '0', branch],
        'verify': [os.path.dirname(work) + '/volition/tools/integrity.sh'],
        'review': [],
    }
    steps = []
    if op in ('build', 'deploy') and params.get('pauseHalogen'):
        steps.extend(['Check agent runs, streaming chats, priority active/queued and halogen-bench.lock',
                      'Stop helena-voice-tts-proxy, helena-voice-tts, helena-halogen'])
    if op == 'deploy':
        steps.append('Check in-flight work and successful review/gate/build/probe for the full SHA')
    steps.append(' '.join(commands[op]) if commands[op] else 'Record branch review with evidence')
    if op == 'probe':
        steps.append('Bind 127.0.0.1:3091, GET /login, stop the probe')
    if op in ('build', 'deploy') and params.get('pauseHalogen'):
        steps.append('Start helena-voice-tts-proxy, helena-halogen, helena-voice-tts')
    if op == 'verify':
        steps.append('Smoke GET /login, /, /chat without following redirects; write the job report')
    return commands[op], steps


def start(ctx, params):
    op = params['operation']
    sha, branch = params['expected'], params['branch']
    if op not in OPERATIONS or not SHA.fullmatch(sha) or not BRANCH.fullmatch(branch):
        raise HostError('InvalidParameter', 'Invalid development operation, branch or full commit')
    if op in ('worktree', 'merge') and not BRANCH.fullmatch(params.get('target', '')):
        raise HostError('InvalidParameter', 'Invalid target branch')
    if op == 'worktree' and (not development.SLUG.fullmatch(params.get('name', '')) or len(params['name']) > 64):
        raise HostError('InvalidParameter', 'Invalid worktree name')
    if op == 'review' and (not params.get('evidence', '').strip() or len(params['evidence']) > 16000):
        raise HostError('InvalidParameter', 'Review evidence is required')
    if op == 'tests':
        files = params.get('testFiles', [])
        if not files or len(files) > 20 or any(not re.fullmatch(r'(?:apps|packages)/[a-z0-9-]+/(?:[a-zA-Z0-9_-]+/)*[a-zA-Z0-9_.-]+\.test\.(?:ts|mjs)', f) for f in files):
            raise HostError('InvalidParameter', 'Name repository test files without command options')
    with privileged.LOCK:
        state = privileged.state(ctx.config)
        if not state['enabled']:
            raise HostError('NotAllowed', 'Root access is disabled')
        epoch = state['epoch']
    commit(ctx, branch, sha)
    argv, steps = plan(ctx, params)
    dry = params.get('dryRun', True)
    if not dry:
        if op in ('build', 'probe', 'deploy'):
            evidence(ctx, 'review', sha)
            evidence(ctx, 'gate', sha)
        if op in ('probe', 'deploy'):
            evidence(ctx, 'build', sha)
        if op == 'deploy':
            evidence(ctx, 'probe', sha)
        if op == 'verify':
            evidence(ctx, 'deploy', sha)
    ident = uuid.uuid4().hex
    value = dict(params, id=ident, epoch=epoch, argv=argv, steps=steps, dryRun=dry,
                 developmentConfig=ctx.config.data.get('development', {}),
                 status='dry-run' if dry else 'pending', output='', exitCode=None,
                 createdAt=iso(ctx.host.now()), finishedAt=iso(ctx.host.now()) if dry else None)
    atomic_write_json(job_path(ctx, ident), value)
    if not dry:
        unit = 'volition-development-' + ident + '.service'
        with privileged.LOCK:
            state = privileged.state(ctx.config)
            if not state['enabled'] or state['epoch'] != epoch:
                raise HostError('NotAllowed', 'Root access was revoked')
            state['units'][unit] = {'startedAt': value['createdAt'], 'actor': params.get('actor')}
            if op == 'probe':
                state['units']['volition-development-probe-' + ident + '.service'] = {'startedAt': value['createdAt'], 'actor': params.get('actor')}
            atomic_write_json(privileged.path(ctx.config), state)
            try:
                command(ctx, ['systemd-run', '--quiet', '--collect', '--service-type=exec', '--unit=' + unit,
                    '--property=KillMode=control-group', '--property=TimeoutStopSec=30s',
                    '--property=RuntimeMaxSec=3h', '--setenv=PYTHONPATH=' + os.path.dirname(os.path.dirname(__file__)),
                    '--property=ExecStopPost=' + shlex.join([sys.executable, '-m', 'helena_host.development_jobs', ctx.config.state_dir, ident, '--restore']),
                    '--', sys.executable, '-m', 'helena_host.development_jobs',
                    ctx.config.state_dir, ident], 10)
            except (HostError, OSError, subprocess.TimeoutExpired):
                state['units'].pop(unit, None)
                state['units'].pop('volition-development-probe-' + ident + '.service', None)
                atomic_write_json(privileged.path(ctx.config), state)
                value.update(status='failed', exitCode=1, finishedAt=iso(ctx.host.now()), output='Development worker could not start')
                atomic_write_json(job_path(ctx, ident), value)
                raise
    return result(ctx, {'id': ident})


def quiet(ctx, pause=False):
    database = ctx.config.data.get('development', {}).get('database', 'itsaplan')
    if not re.fullmatch(r'[a-z][a-z0-9_]{0,62}', database):
        raise HostError('InvalidParameter', 'Invalid development database configuration')
    count = command(ctx, ['runuser', '-u', 'postgres', '--', 'psql', '-d', database, '-qAtX', '-c',
        "SELECT (SELECT count(*) FROM agent_run WHERE status = 'pending') + (SELECT count(*) FROM agent_chat_message WHERE status = 'streaming')"], 5)
    if count != '0':
        raise HostError('Busy', 'Agent runs or streaming chats are in flight')
    if pause:
        body = command(ctx, ['curl', '--fail', '--silent', '--max-time', '5', 'http://127.0.0.1:8741/priority/status'], 6)
        try:
            status = json.loads(body)
            values = [*status['active'].values(), *status['queued'].values()]
            if not values or any(type(value) is not int or value != 0 for value in values):
                raise ValueError()
        except (ValueError, KeyError, TypeError, AttributeError):
            raise HostError('Busy', 'Halogen priority proxy is busy or unavailable') from None


def wait_quiet(ctx, epoch, pause=False):
    for _ in range(60):
        current = privileged.state(ctx.config)
        if not current['enabled'] or current['epoch'] != epoch:
            raise HostError('NotAllowed', 'Root access was revoked')
        try:
            quiet(ctx, pause)
            return
        except HostError as error:
            if error.code != 'Busy':
                raise
        ctx.host.sleep(5)
    raise HostError('Busy', 'Agent work has not become idle after five minutes')


def restore(ctx, value):
    units = ('helena-voice-tts-proxy.service', 'helena-halogen.service', 'helena-voice-tts.service')
    active = value.get('restoreUnits', [])
    if any(unit not in units for unit in active):
        raise HostError('InvalidParameter', 'Invalid development recovery state')
    failure = None
    for unit in units:
        if unit in active:
            try:
                command(ctx, ['systemctl', 'start', unit], 180)
            except HostError as error:
                failure = error
    if failure:
        raise failure
    value['restoreUnits'] = []
    if value.get('id'):
        atomic_write_json(job_path(ctx, value['id']), value)


@contextmanager
def pause(ctx, requested, value=None):
    if not requested:
        yield
        return
    work, _ = paths(ctx)
    with development.directory(work) as fd:
        lock = development.open_file(fd, 'halogen-bench.lock', os.O_CREAT | os.O_RDWR)
        try:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise HostError('Busy', 'Halogen benchmark is running') from None
            quiet(ctx, pause=True)
            units = ('helena-voice-tts-proxy.service', 'helena-voice-tts.service', 'helena-halogen.service')
            active = [unit for unit in units if ctx.host.run(['systemctl', 'is-active', '--quiet', unit], timeout=5).returncode == 0]
            recovery = value if value is not None else {}
            recovery['restoreUnits'] = active
            if value is not None:
                atomic_write_json(job_path(ctx, value['id']), value)
            try:
                for unit in units:
                    command(ctx, ['systemctl', 'stop', unit], 60)
                yield
            finally:
                restore(ctx, recovery)
        finally:
            os.close(lock)


def probe(ctx, value):
    artifact = evidence(ctx, 'build', value['expected'])['artifact']
    command(ctx, ['python3', NATIVE + '/web-artifact.py', 'verify', artifact, '--commit', value['expected']], 120)
    if command(ctx, ['ss', '-H', '-ltn', 'sport = :3091'], 5):
        raise HostError('Busy', 'Probe port 3091 is already occupied')
    work, _ = paths(ctx)
    tree = work + '/tmp/volition-probe-' + value['id']
    command(ctx, owner(ctx, ['mkdir', tree]), 5)
    unit = 'volition-development-probe-' + value['id'] + '.service'
    started = False
    try:
        command(ctx, owner(ctx, ['cp', '-a', artifact + '/standalone/.', tree]), 30)
        command(ctx, owner(ctx, ['cp', '-a', artifact + '/static', tree + '/apps/web/.next/']), 30)
        if os.path.isdir(artifact + '/public'):
            command(ctx, owner(ctx, ['cp', '-a', artifact + '/public', tree + '/apps/web/']), 30)
        with privileged.LOCK:
            state = privileged.state(ctx.config)
            if not state['enabled'] or state['epoch'] != value['epoch']:
                raise HostError('NotAllowed', 'Root access was revoked')
        command(ctx, ['systemd-run', '--quiet', '--collect', '--unit=' + unit,
            '--property=RuntimeMaxSec=90s', '--setenv=PORT=3091', '--setenv=HOSTNAME=127.0.0.1',
            '--setenv=API_URL=http://127.0.0.1:3000', '--', *owner(ctx, ['node', tree + '/apps/web/server.js'])], 10)
        started = True
        for _ in range(30):
            code = ctx.host.run(['curl', '--silent', '--max-time', '2', '--output', '/dev/null', '--write-out', '%{http_code}', 'http://127.0.0.1:3091/login'], timeout=3)
            active = ctx.host.run(['systemctl', 'is-active', '--quiet', unit], timeout=5)
            if code.returncode == 0 and code.stdout == '200' and active.returncode == 0:
                return 'Probe /login: 200'
            ctx.host.sleep(1)
        raise HostError('CommandFailed', 'Web probe did not serve /login with HTTP 200')
    finally:
        try:
            if started:
                command(ctx, ['systemctl', 'stop', unit], 30)
        finally:
            command(ctx, owner(ctx, ['rm', '-rf', '--', tree]), 30)


def execute(ctx, ident):
    file = job_path(ctx, ident)
    value = json_load_file(file)
    if not value or value['status'] != 'pending' or value['dryRun']:
        raise HostError('NotAllowed', 'Development job cannot be replayed')
    value['status'] = 'running'
    atomic_write_json(file, value)
    try:
        with privileged.LOCK:
            state = privileged.state(ctx.config)
            if not state['enabled'] or state['epoch'] != value['epoch']:
                raise HostError('NotAllowed', 'Root access was revoked')
        op = value['operation']
        commit(ctx, value['branch'], value['expected'])
        work, repo = paths(ctx)
        output = ''
        if op == 'review':
            output = value['evidence']
        elif op == 'merge':
            check = ctx.host.run(owner(ctx, value['argv']), timeout=60, output_limit=16384)
            output = check.stdout
            if check.returncode == 1:
                value['status'] = 'conflicts'
                value['exitCode'] = 1
            elif check.returncode:
                raise HostError('CommandFailed', 'Merge trial failed')
        elif op == 'probe':
            output = probe(ctx, value)
        elif op == 'verify':
            if command(ctx, ['git', '-C', LIVE, 'rev-parse', 'HEAD'], 5) != value['expected'] or (ctx.host.read('/var/lib/volition/deploy/deployed') or '').strip() != value['expected']:
                raise HostError('Busy', 'Live checkout and deployed marker must match this commit')
            for path in ('/login', '/', '/chat'):
                code = command(ctx, ['curl', '--silent', '--max-time', '10', '--output', '/dev/null', '--write-out', '%{http_code}', 'http://127.0.0.1:3001' + path], 12)
                if code not in (('200',) if path == '/login' else ('200', '302', '307')):
                    raise HostError('CommandFailed', 'Release smoke failed')
                output += path + ': ' + code + '\n'
            output += command(ctx, value['argv'], 120)
        elif op == 'tests':
            db_url = ctx.config.data.get('development', {}).get('testDatabaseUrl', '')
            if not re.fullmatch(r'postgres(?:ql)?://[^/@]+@127\.0\.0\.1:\d+/[a-z0-9_]+_test', db_url):
                raise HostError('NotAllowed', 'Configure a private loopback test database first')
            tree = work + '/tmp/volition-tests-' + ident
            command(ctx, owner(ctx, ['git', '-C', repo, 'worktree', 'add', '--detach', tree, value['expected']]), 30)
            try:
                command(ctx, owner(ctx, [work + '/heavy.sh', 'env', '--chdir=' + tree, 'bun', 'install', '--offline', '--frozen-lockfile', '--ignore-scripts']), 300)
                test_env = ['NODE_ENV=test', 'DATABASE_URL=' + db_url,
                    'APP_URL=http://localhost:3001', 'API_URL=http://localhost:3000',
                    'BETTER_AUTH_SECRET=volition-development-test-only',
                    'APP_ENCRYPTION_KEY=volition-development-test-only']
                command(ctx, owner(ctx, [work + '/heavy.sh', 'env', '--chdir=' + tree,
                    *test_env, 'SKIP_PRE_MIGRATION_BACKUP=1',
                    'bun', 'packages/db/src/migrate.ts']), 300)
                output = command(ctx, owner(ctx, [work + '/heavy.sh', 'env', '--chdir=' + tree,
                    *test_env,
                    'bun', 'test', '--preload=' + tree + '/apps/api/src/__tests__/helpers/preload.ts', *value['testFiles']]), 3600)
            finally:
                command(ctx, owner(ctx, ['git', '-C', repo, 'worktree', 'remove', '--force', tree]), 30)
        else:
            if op == 'deploy':
                wait_quiet(ctx, value['epoch'], value.get('pauseHalogen', False))
                for required in ('review', 'gate', 'build', 'probe'):
                    evidence(ctx, required, value['expected'])
                value['argv'][4] = evidence(ctx, 'build', value['expected'])['artifact']
            if op == 'build' and value.get('pauseHalogen'):
                wait_quiet(ctx, value['epoch'], True)
            with pause(ctx, op in ('build', 'deploy') and value.get('pauseHalogen', False), value):
                argv = value['argv'] if op == 'deploy' else owner(ctx, value['argv'])
                output = command(ctx, argv, 10500)
            if op == 'build':
                candidates = [line for line in output.splitlines() if line.startswith(work + '/tmp/volition-artifacts/' + value['expected'] + '/web-')]
                if len(candidates) != 1:
                    raise HostError('CommandFailed', 'Build did not return one artifact')
                value['artifact'] = candidates[0]
        commit(ctx, value['branch'], value['expected'])
        current = privileged.state(ctx.config)
        if not current['enabled'] or current['epoch'] != value['epoch']:
            raise HostError('NotAllowed', 'Root access was revoked')
        if value['status'] == 'running':
            value.update(status='success', exitCode=0)
        value['output'] = '\n'.join(line for line in output.splitlines() if op in ('review', 'merge', 'verify', 'probe') or re.search(r'\b(pass|fail|ok|Tasks:|Tests:)\b', line))[-16000:]
    except (HostError, OSError, subprocess.TimeoutExpired) as error:
        value.update(status='revoked' if isinstance(error, HostError) and error.code == 'NotAllowed' else 'failed',
                     exitCode=124 if isinstance(error, subprocess.TimeoutExpired) else 1,
                     output=error.message if isinstance(error, HostError) else 'Development job interrupted')
    finally:
        value['finishedAt'] = iso(ctx.host.now())
        atomic_write_json(file, value)
        audit.append(ctx.config.state_dir, {'at': value['finishedAt'], 'actor': value.get('actor'),
            'method': 'DevelopmentCompleted', 'params': {'id': ident, 'operation': value['operation'], 'expected': value['expected']},
            'ok': value['status'] == 'success', 'status': value['status']}, lambda _: None)
        with open(file[:-5] + '-bericht.md', 'w', encoding='utf-8') as report:
            report.write(f"{value['operation']}: {value['status']}\nBranch {value['branch']}, SHA {value['expected']}\n{value['output']}\n")
    return result(ctx, {'id': ident})


if __name__ == '__main__':
    from types import SimpleNamespace
    from .common import Host
    state_dir, ident = sys.argv[1:3]
    context = SimpleNamespace(host=Host(), config=SimpleNamespace(state_dir=state_dir, data={}))
    value = json_load_file(job_path(context, ident))
    context.config.data = {'development': value['developmentConfig']}
    def interrupted(*_):
        raise HostError('NotAllowed', 'Development job was stopped')
    signal.signal(signal.SIGTERM, interrupted)
    if sys.argv[3:] == ['--restore']:
        restore(context, value)
    else:
        execute(context, ident)
