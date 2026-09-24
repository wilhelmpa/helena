#!/usr/bin/python3 -I
"""Proof tests of the agent isolation (design §6), run as root on Kingston in a test environment
that touches nothing of the live system:

- users vpt-* (projects vpt-alpha, vpt-beta, vpt-home; vpt-hermes as the runner, vpt-egress,
  vpt-browser, vpt-other) and the group vpt-agents, which must exist (see README.md);
- data below /srv/vpt-test, sockets below /run/vpt-agents and /run/vpt-launcher;
- transient units vpt-launcher, vpt-egress, vpt-plan and the agent units vpt-agent-*, built
  from the production unit files and launcher.json with the test paths put in.

    sudo python3 harness.py setup --source <isolation dir> --plan-port 3900
    sudo python3 harness.py start
    sudo python3 harness.py prove [--only 1,2,…]
    sudo python3 harness.py stop
    sudo python3 harness.py teardown

The live paths (/srv/volition, /var/lib/volition, /etc/volition) are hidden in the test units
exactly as in production, so the proofs about them hold for the real ones.
"""

from __future__ import annotations

import argparse
import configparser
import grp
import json
import os
import pwd
import shutil
import subprocess
import sys
import time

ROOT = '/srv/vpt-test'
ISO = f'{ROOT}/isolation'
PROOF = f'{ROOT}/proof'
RUN_AGENTS = '/run/vpt-agents'
# The browser gateway's per-project socket directories (browser-gateway-server.mjs).
RUN_GATEWAY = '/run/vpt-browser/gateway'
RUN_LAUNCHER = '/run/vpt-launcher'
LAUNCH_SOCKET = f'{RUN_LAUNCHER}/launch.sock'
OPEN_SOCKET = f'{RUN_LAUNCHER}/open.sock'
STATE = f'{PROOF}/state.json'
PROJECTS = {'alpha': ('ALPHA', 1), 'beta': ('BETA', 2)}
USERS = ['vpt-alpha', 'vpt-beta', 'vpt-home', 'vpt-hermes', 'vpt-egress', 'vpt-browser', 'vpt-other']


def sh(*argv: str, check: bool = True, capture: bool = True, input: bytes | None = None,
       env: dict | None = None, timeout: float = 300) -> subprocess.CompletedProcess:
    done = subprocess.run(list(argv), capture_output=capture, input=input, env=env, timeout=timeout)
    if check and done.returncode != 0:
        raise SystemExit(f'{" ".join(argv[:6])}… failed ({done.returncode}): '
                         f'{(done.stderr or b"").decode(errors="replace")[-600:]}')
    return done


def uid(name: str) -> int:
    return pwd.getpwnam(name).pw_uid


def gid(name: str) -> int:
    return grp.getgrnam(name).gr_gid


def load_state() -> dict:
    try:
        with open(STATE, encoding='utf-8') as handle:
            return json.load(handle)
    except FileNotFoundError:
        return {}


def save_state(state: dict) -> None:
    with open(STATE, 'w', encoding='utf-8') as handle:
        json.dump(state, handle, indent=2)
    os.chmod(STATE, 0o600)


# ── setup ────────────────────────────────────────────────────────────────────────────────


def test_config(source: str) -> dict:
    with open(os.path.join(source, 'launcher.json'), encoding='utf-8') as handle:
        config = json.load(handle)
    hermes = config['runtimes']['hermes']
    config.update({
        'callers': ['vpt-hermes'],
        'userPrefix': 'vpt-',
        'agentsGroup': 'vpt-agents',
        'uidRange': [58900, 58999],
        'unitPrefix': 'vpt-agent-',
        'terminalPrefix': 'vpt-terminal-',
        'registryRoot': f'{ROOT}/provisioning/projects',
        'workspaceRoot': f'{ROOT}/workspaces/projects',
        'homeWorkspace': f'{ROOT}/workspaces/home',
        'profilesRoot': f'{ROOT}/hermes/profiles',
        'vaultRoot': f'{ROOT}/vault',
        'runnerUser': 'vpt-hermes',
        'readersGroup': 'vpt-hermes',
        'stateRoot': f'{ROOT}/launcher-state',
        'sandbox': f'{ISO}/sandbox.py',
        'tmuxConf': f'{ISO}/tmux.conf',
        # A third way out for the test alone: the scripted model of the Hermes proof.
        'sockets': {'egress': f'{RUN_AGENTS}/egress.sock', 'plan': f'{RUN_AGENTS}/plan.sock',
                    'model': f'{RUN_AGENTS}/model.sock'},
        'forwards': {'egress': 3128, 'plan': 3000, 'model': 8765},
        # The production list, and the test data besides.
        'hide': config['hide'] + [f'{ROOT}/{name}' for name in (
            'hermes', 'workspaces', 'vault', 'provisioning', 'secrets', 'project-browser',
            'launcher-state', 'proof', 'hermes-global')],
    })
    # The production target, which the MCP shim looks in; the test's own sources.
    config['browserGateway'] = {'root': RUN_GATEWAY, 'target': '/run/volition-agents/browser'}
    config['browser'] = {
        'user': 'vpt-browser', 'root': f'{ROOT}/project-browser/projects', 'trash': f'{ROOT}/project-browser/trash',
        'script': f'{ISO}/browser/project-browser-state.mjs', 'node': '/usr/local/bin/node',
        'bases': {'display': 260, 'cdp': 19260, 'vnc': 15960, 'noVnc': 16160},
    }
    config['runtimes'] = {
        'probe': {
            'exec': '/usr/bin/python3',
            'fixedArgs': ['-I', f'{ISO}/probe.py'],
            'callerArgs': True,
        },
        'hermes': {
            **hermes,
            # The live Hermes code, read-only; its configuration and model are the test's.
            'readOnly': [
                '/var/lib/volition/hermes/venv', '/var/lib/volition/hermes/python',
                '/srv/volition/source/hermes', f'{ROOT}/hermes/config.yaml', f'{ISO}/hermes-plugins',
            ],
            'optionalReadOnly': [],
            'credentialBinds': [],
            'env': {**hermes['env'], 'HERMES_SHARED_AUTH_DIR': f'{ROOT}/hermes/shared'},
            'profileLinks': {
                'config.yaml': f'{ROOT}/hermes/config.yaml',
                'plugins/plan-approval-guard': f'{ISO}/hermes-plugins/plan-approval-guard',
            },
        },
        'claude': {'exec': f'{ROOT}/bin/claude', 'env': config['runtimes']['claude'].get('env', {})},
        'codex': {'exec': '/usr/local/bin/node', 'fixedArgs': [f'{ROOT}/codex/bin/codex.js']},
        'profile-helper': {
            **config['runtimes']['profile-helper'],
            'fixedArgs': [f'{ISO}/runner/cli.js', 'profile-helper'],
            'readOnly': [f'{ISO}/runner', '/var/lib/volition/hermes/venv', '/var/lib/volition/hermes/python',
                         '/srv/volition/source/hermes'],
        },
    }
    return config


def install_tree(source: str) -> None:
    os.makedirs(ISO, mode=0o755, exist_ok=True)
    for name in os.listdir(source):
        path = os.path.join(source, name)
        if name.endswith('.py') and os.path.isfile(path):
            shutil.copyfile(path, os.path.join(ISO, name))
    shutil.copyfile(os.path.join(source, 'proof', 'probe.py'), os.path.join(ISO, 'probe.py'))
    shutil.copyfile(os.path.join(source, 'egress.json'), os.path.join(ISO, 'egress.json'))
    shutil.copyfile(os.path.join(source, 'proof', 'mock_model.py'), os.path.join(ISO, 'mock_model.py'))
    shutil.copyfile(os.path.join(source, 'proof', 'cdp.mjs'), os.path.join(ISO, 'cdp.mjs'))
    shutil.copyfile(os.path.join(source, '..', 'native', 'terminal', 'tmux.conf'), os.path.join(ISO, 'tmux.conf'))
    # The browser state script with what it imports, as isolation.sh installs it.
    os.makedirs(os.path.join(ISO, 'browser'), exist_ok=True)
    for name in ('project-browser-state.mjs', 'project-browser.mjs', 'atomic-json.mjs', 'move-path.mjs'):
        shutil.copyfile(os.path.join(source, '..', 'integration', name), os.path.join(ISO, 'browser', name))
    plugins = os.path.join(source, '..', 'integration', 'hermes-plugins')
    if os.path.isdir(plugins):
        shutil.rmtree(os.path.join(ISO, 'hermes-plugins'), ignore_errors=True)
        shutil.copytree(plugins, os.path.join(ISO, 'hermes-plugins'))
    runner = os.path.join(source, '..', '..', '..', 'packages', 'runner', 'dist')
    if os.path.isdir(runner):
        shutil.rmtree(os.path.join(ISO, 'runner'), ignore_errors=True)
        shutil.copytree(runner, os.path.join(ISO, 'runner'))
    for directory, dirs, files in os.walk(ISO):
        os.chown(directory, 0, 0)
        os.chmod(directory, 0o755)
        for name in files:
            os.chown(os.path.join(directory, name), 0, 0)
            os.chmod(os.path.join(directory, name), 0o644)


def mkdir(path: str, owner: str, group: str, mode: int) -> None:
    os.makedirs(path, exist_ok=True)
    os.chown(path, uid(owner) if owner != 'root' else 0, gid(group) if group != 'root' else 0)
    os.chmod(path, mode)


def write(path: str, content: str, owner: str, group: str, mode: int) -> None:
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(content)
    os.chown(path, uid(owner) if owner != 'root' else 0, gid(group) if group != 'root' else 0)
    os.chmod(path, mode)


def setup(args: argparse.Namespace) -> None:
    for name in USERS:
        uid(name)
    gid('vpt-agents')
    source = os.path.realpath(args.source)
    mkdir(ROOT, 'root', 'root', 0o755)
    install_tree(source)
    config = test_config(source)
    with open(f'{ISO}/launcher.json', 'w', encoding='utf-8') as handle:
        json.dump(config, handle, indent=2)
    os.chmod(f'{ISO}/launcher.json', 0o644)

    mkdir(PROOF, 'root', 'root', 0o700)
    mkdir(f'{ROOT}/launcher-state', 'root', 'root', 0o700)
    mkdir(f'{ROOT}/egress-state', 'vpt-egress', 'vpt-egress', 0o700)
    mkdir(f'{ROOT}/bin', 'root', 'root', 0o755)
    # Claude Code and Codex as the developer installed them, copied where the test units see
    # them (the live units would find them in /usr/local/bin).
    home = os.path.expanduser('~wilhelmpa')
    claude = os.path.realpath(f'{home}/.local/bin/claude')
    if os.path.isfile(claude):
        shutil.copyfile(claude, f'{ROOT}/bin/claude')
        os.chmod(f'{ROOT}/bin/claude', 0o755)
    codex = f'{home}/.local/lib/node_modules/@openai/codex'
    if os.path.isdir(codex) and not os.path.isdir(f'{ROOT}/codex'):
        shutil.copytree(codex, f'{ROOT}/codex', symlinks=True)
        for directory, _dirs, files in os.walk(f'{ROOT}/codex'):
            os.chown(directory, 0, 0)
            for name in files:
                path = os.path.join(directory, name)
                if not os.path.islink(path):
                    os.chown(path, 0, 0)
                    os.chmod(path, 0o755 if os.stat(path).st_mode & 0o100 else 0o644)
    # Registry, as provisioning writes it.
    mkdir(f'{ROOT}/provisioning', 'vpt-hermes', 'vpt-hermes', 0o755)
    mkdir(f'{ROOT}/provisioning/projects', 'vpt-hermes', 'vpt-hermes', 0o700)
    for slug, (key, project_id) in PROJECTS.items():
        write(f'{ROOT}/provisioning/projects/{slug}.json',
              json.dumps({'schemaVersion': 1, 'slug': slug, 'project': {'id': project_id, 'key': key}}),
              'vpt-hermes', 'vpt-hermes', 0o600)
    # Workspaces, as provisioning creates them before the project user exists.
    mkdir(f'{ROOT}/workspaces', 'vpt-hermes', 'vpt-hermes', 0o750)
    mkdir(f'{ROOT}/workspaces/projects', 'vpt-hermes', 'vpt-hermes', 0o750)
    for slug in PROJECTS:
        mkdir(f'{ROOT}/workspaces/projects/{slug}', 'vpt-hermes', 'vpt-hermes', 0o750)
        write(f'{ROOT}/workspaces/projects/{slug}/secret-{slug}.txt', f'workspace of {slug}\n',
              'vpt-hermes', 'vpt-hermes', 0o640)
        mkdir(f'{ROOT}/workspaces/projects/{slug}/src', 'vpt-hermes', 'vpt-hermes', 0o750)
        write(f'{ROOT}/workspaces/projects/{slug}/src/main.py', 'print(1)\n', 'vpt-hermes', 'vpt-hermes', 0o640)
    # The global Hermes home and its profiles root, runner-owned and private.
    mkdir(f'{ROOT}/hermes', 'vpt-hermes', 'vpt-hermes', 0o755)
    mkdir(f'{ROOT}/hermes/profiles', 'vpt-hermes', 'vpt-hermes', 0o700)
    mkdir(f'{ROOT}/hermes/shared', 'vpt-hermes', 'vpt-hermes', 0o700)
    write(f'{ROOT}/hermes/auth.json', '{"secret": "model token of the runner"}\n', 'vpt-hermes', 'vpt-hermes', 0o600)
    # The Home agent's state in the global home, which the migration copies into its profile,
    # and the runner's own files there, which it must leave alone.
    write(f'{ROOT}/hermes/SOUL.md', 'You are the Home agent.\n', 'vpt-hermes', 'vpt-hermes', 0o600)
    mkdir(f'{ROOT}/hermes/memories', 'vpt-hermes', 'vpt-hermes', 0o700)
    write(f'{ROOT}/hermes/memories/MEMORY.md', 'home memory\n', 'vpt-hermes', 'vpt-hermes', 0o600)
    mkdir(f'{ROOT}/hermes/run', 'vpt-hermes', 'vpt-hermes', 0o700)
    mkdir(f'{ROOT}/hermes/run/agents', 'vpt-hermes', 'vpt-hermes', 0o700)
    write(f'{ROOT}/hermes/run/agents/alpha.json', '{"apiKey": "runner descriptor"}\n', 'vpt-hermes', 'vpt-hermes', 0o600)
    import sqlite3  # noqa: PLC0415
    database = f'{ROOT}/hermes/state.db'
    if os.path.exists(database):
        os.unlink(database)
    with sqlite3.connect(database) as connection:
        connection.execute('create table sessions (id text)')
        connection.execute("insert into sessions values ('home-session-1')")
    os.chown(database, uid('vpt-hermes'), gid('vpt-hermes'))
    write(f'{ROOT}/hermes/config.yaml',
          'model:\n  provider: custom\n'
          '  base_url: http://127.0.0.1:8765/v1\n'
          '  default: vpt-mock\n  api_key: vpt-mock-key\n'
          'agent:\n  max_turns: 8\n'
          'approvals:\n  single_query_mode: approve\n'
          'plugins:\n  enabled: [plan-approval-guard]\n'
          'toolsets: [terminal, file]\n',
          'vpt-hermes', 'vpt-agents', 0o640)
    # The vault: every service reads it through a shared group, a project its own folder.
    mkdir(f'{ROOT}/vault', 'root', 'vpt-hermes', 0o2770)
    for name in ('Home', 'Projects', 'Private'):
        mkdir(f'{ROOT}/vault/{name}', 'root', 'vpt-hermes', 0o2770)
    for slug, (key, _) in PROJECTS.items():
        mkdir(f'{ROOT}/vault/Projects/{key}', 'vpt-hermes', 'vpt-hermes', 0o2770)
        write(f'{ROOT}/vault/Projects/{key}/note-{slug}.md', f'vault of {slug}\n', 'vpt-hermes', 'vpt-hermes', 0o660)
    write(f'{ROOT}/vault/Home/home.md', 'vault of home\n', 'root', 'vpt-hermes', 0o660)
    write(f'{ROOT}/vault/Private/private.md', 'private\n', 'root', 'vpt-hermes', 0o660)
    # Secrets and browser profiles no agent may read.
    mkdir(f'{ROOT}/secrets', 'root', 'root', 0o700)
    write(f'{ROOT}/secrets/token', 'secret\n', 'root', 'root', 0o600)
    mkdir(f'{ROOT}/project-browser', 'vpt-browser', 'vpt-browser', 0o700)
    for slug in PROJECTS:
        mkdir(f'{ROOT}/project-browser/{slug}', 'vpt-browser', 'vpt-browser', 0o700)
        write(f'{ROOT}/project-browser/{slug}/Cookies', 'cookie\n', 'vpt-browser', 'vpt-browser', 0o600)
    # What an agent that ran as the runner user could have left in its workspace: a hard link
    # to the runner's model token and a symbolic link to a root secret. The migration must
    # hand neither target to the project.
    trap = f'{ROOT}/workspaces/projects/alpha/stolen-auth.json'
    if os.path.lexists(trap):
        os.unlink(trap)
    os.link(f'{ROOT}/hermes/auth.json', trap)
    link = f'{ROOT}/workspaces/projects/alpha/token-link'
    if os.path.lexists(link):
        os.unlink(link)
    os.symlink(f'{ROOT}/secrets/token', link)
    # The egress proxy's token, and the copy the test Plan API reads.
    api_copy = os.path.expanduser('~wilhelmpa/agent-work/plan-isolation-proof/egress.token')
    mkdir(os.path.dirname(api_copy), 'wilhelmpa', 'wilhelmpa', 0o700)
    # Kept across runs: the test Plan API reads its copy once, when it starts.
    try:
        with open(api_copy, encoding='utf-8') as handle:
            token = handle.read().strip()
    except FileNotFoundError:
        token = ''
    if len(token) < 32:
        token = os.urandom(24).hex()
        write(api_copy, token, 'wilhelmpa', 'wilhelmpa', 0o600)
    write(f'{PROOF}/egress.token', token, 'root', 'root', 0o600)
    save_state({'planPort': args.plan_port, 'modelPort': args.model_port, 'source': source})
    print('setup done')


# ── units ────────────────────────────────────────────────────────────────────────────────


def unit_properties(path: str, section: str, replace: dict[str, str]) -> list[tuple[str, str]]:
    parser = configparser.RawConfigParser(strict=False, delimiters=('=',))
    parser.optionxform = str
    properties = []
    with open(path, encoding='utf-8') as handle:
        current = None
        for line in handle:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('['):
                current = line.strip('[]')
                continue
            if current != section:
                continue
            for old, new in replace.items():
                line = line.replace(old, new)
            key, _, value = line.partition('=')
            properties.append((key, value))
    return properties


def start_unit(name: str, service: str, socket: str | None, replace: dict[str, str],
               extra: list[str] | None = None) -> None:
    base = os.path.join(load_state()['source'], 'systemd')
    command = ['systemd-run', f'--unit={name}', '--quiet', '--collect']
    exec_start = None
    for key, value in unit_properties(os.path.join(base, service), 'Service', replace):
        if key == 'ExecStart':
            exec_start = value
        elif key == 'Type':
            command.append(f'--service-type={value}')
        elif key == 'Environment':
            command.append(f'--setenv={value}')
        else:
            command.append(f'--property={key}={value}')
    if socket:
        for key, value in unit_properties(os.path.join(base, socket), 'Socket', replace):
            command.append(f'--socket-property={key}={value}')
    command += extra or []
    command += ['--', *exec_start.split()]
    sh(*command)


def start(args: argparse.Namespace) -> None:
    state = load_state()
    os.makedirs(RUN_AGENTS, mode=0o755, exist_ok=True)
    common = {
        '/usr/local/lib/volition-isolation': ISO,
        'VOLITION_USER_PREFIX=vp-': 'VOLITION_USER_PREFIX=vpt-',
        'VOLITION_UNIT_PREFIX=volition-agent-': 'VOLITION_UNIT_PREFIX=vpt-agent-',
        'VOLITION_AGENTS_GROUP=volition-agents': 'VOLITION_AGENTS_GROUP=vpt-agents',
        '/run/volition-agents': RUN_AGENTS,
        'SocketGroup=volition-agents': 'SocketGroup=vpt-agents',
    }
    start_unit('vpt-egress', 'volition-egress.service', 'volition-egress.socket', {
        **common,
        'User=volition-egress': 'User=vpt-egress', 'Group=volition-egress': 'Group=vpt-egress',
        '/etc/volition/agent-egress.token': f'{PROOF}/egress.token',
        'StateDirectory=volition-egress': f'Environment=STATE_DIRECTORY={ROOT}/egress-state',
        'StateDirectoryMode=0700': 'UMask=0077',
        'http://127.0.0.1:3000': f'http://127.0.0.1:{state["planPort"]}',
        f'-/srv/volition': f'-/srv/volition -{ROOT}/secrets -{ROOT}/hermes -{PROOF}',
    }, ['--socket-property=SocketUser=root', '--setenv=VOLITION_EGRESS_REFRESH_SEC=2',
        '--setenv=VOLITION_EGRESS_FLUSH_SEC=2'])
    start_unit('vpt-plan', 'volition-agent-plan.service', 'volition-agent-plan.socket', {
        **common,
        '127.0.0.1:3000': f'127.0.0.1:{state["planPort"]}',
    })
    start_unit('vpt-launcher', 'volition-agent-launcher.service', 'volition-agent-launcher.socket', {
        **common,
        '/run/volition-agent-launcher': RUN_LAUNCHER,
        'SocketGroup=volition-launcher': 'SocketGroup=vpt-hermes',
        'StateDirectory=volition-agent-launcher': 'UMask=0022',
        'StateDirectoryMode=0700': 'UMask=0022',
    })
    # A second socket for the same launcher code, open to everyone: it proves the launcher
    # itself refuses a caller that is not the runner, not only the socket's permissions.
    start_unit('vpt-launcher-open', 'volition-agent-launcher.service', 'volition-agent-launcher.socket', {
        **common,
        '/run/volition-agent-launcher/launch.sock': OPEN_SOCKET,
        'SocketGroup=volition-launcher': 'SocketGroup=vpt-hermes',
        'SocketMode=0660': 'SocketMode=0666',
        'StateDirectory=volition-agent-launcher': 'UMask=0022',
        'StateDirectoryMode=0700': 'UMask=0022',
    })
    command = ('echo "written by hermes as $(id -un)" > proof-hermes.txt && '
               f'echo "vault note by hermes" > {ROOT}/vault/Projects/ALPHA/proof-hermes.md && '
               'curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: $ITSAPLAN_API_KEY" '
               'http://127.0.0.1:3000/me > proof-plan.txt; '
               'curl -s -o /dev/null -w "%{http_code}" --max-time 15 https://example.com > proof-egress.txt; '
               'cat proof-plan.txt proof-egress.txt')
    sh('systemd-run', '--unit=vpt-model', '--quiet', '--collect',
       f'--socket-property=ListenStream={RUN_AGENTS}/model.sock', '--socket-property=SocketMode=0660',
       '--socket-property=SocketGroup=vpt-agents', '--property=DynamicUser=yes',
       '--property=ProtectSystem=strict', '--property=PrivateNetwork=yes', '--property=NoNewPrivileges=yes',
       f'--setenv=MOCK_COMMAND={command}', '--', '/usr/bin/python3', '-I', f'{ISO}/mock_model.py')
    time.sleep(0.5)
    # The agents' profiles as they are before the migration: the runner's.
    for profile in ('alpha', 'alpha_7', 'beta'):
        mkdir(f'{ROOT}/hermes/profiles/{profile}', 'vpt-hermes', 'vpt-hermes', 0o700)
        write(f'{ROOT}/hermes/profiles/{profile}/MEMORY.md', f'memory of {profile}\n',
              'vpt-hermes', 'vpt-hermes', 0o600)
    migrate = ['/usr/bin/python3', '-I', f'{ISO}/migrate.py', 'apply', '--config', f'{ISO}/launcher.json',
               '--browser-root', f'{ROOT}/project-browser', '--browser-user', 'vpt-browser',
               '--model-auth', f'{ROOT}/hermes/config.yaml']
    dry = sh(*migrate, '--dry-run')
    with open(f'{PROOF}/migrate-dry-run.txt', 'wb') as handle:
        handle.write(dry.stdout + dry.stderr)
    state = load_state()
    state['afterDryRun'] = {
        'workspaceFileUid': os.stat(f'{ROOT}/workspaces/projects/alpha/secret-alpha.txt').st_uid,
        'homeProfileExists': os.path.exists(f'{ROOT}/hermes/profiles/home'),
    }
    save_state(state)
    done = sh(*migrate)
    with open(f'{PROOF}/migrate-apply.txt', 'wb') as handle:
        handle.write(done.stdout + done.stderr)
    again = sh(*migrate, '--dry-run')
    with open(f'{PROOF}/migrate-again.txt', 'wb') as handle:
        handle.write(again.stdout + again.stderr)
    # Provisioning of a running system: the launcher's own call, idempotent after the migration.
    answer = client(['ensure-project-user', 'alpha', '--profile', 'alpha', '--profile', 'alpha_7'])
    print(f'ensure-project-user alpha: {answer.stdout.decode().strip()}')
    print('started')


def client(argv: list[str], *, user: str = 'vpt-hermes', socket_path: str = LAUNCH_SOCKET,
           stdin: bytes | None = None, check: bool = True, timeout: float = 300) -> subprocess.CompletedProcess:
    env = {'PATH': '/usr/bin:/bin', 'VOLITION_LAUNCHER_SOCKET': socket_path}
    return sh('/usr/sbin/runuser', '-u', user, '--', '/usr/bin/python3', '-I', f'{ISO}/launch_client.py', *argv,
              check=check, input=stdin or b'', env=env, timeout=timeout)


def stop(args: argparse.Namespace) -> None:
    listing = sh('systemctl', 'list-units', '--plain', '--no-legend', '--all', 'vpt-*', check=False)
    units = [line.split()[0] for line in listing.stdout.decode().splitlines() if line.split()]
    # The test Plan API is started and stopped by plan-api.sh.
    units = [unit for unit in units if not unit.startswith('vpt-plan-api') or getattr(args, 'all', False)]
    for unit in units:
        sh('systemctl', 'stop', unit, check=False)
    for unit in units:
        sh('systemctl', 'reset-failed', unit, check=False)
    print(f'stopped {len(units)} units')


def teardown(args: argparse.Namespace) -> None:
    stop(args)
    shutil.rmtree(ROOT, ignore_errors=True)
    shutil.rmtree(RUN_AGENTS, ignore_errors=True)
    for leftover in ('/var/lib/vpt-egress', '/var/lib/vpt-launcher', '/var/lib/vpt-launcher-open',
                     '/var/lib/private/vpt-egress'):
        shutil.rmtree(leftover, ignore_errors=True)
    shutil.rmtree(RUN_LAUNCHER, ignore_errors=True)
    removed = []
    if args.users:
        for entry in pwd.getpwall():
            if entry.pw_name.startswith('vpt-'):
                sh('/usr/sbin/userdel', entry.pw_name, check=False)
                removed.append(entry.pw_name)
        for entry in grp.getgrall():
            if entry.gr_name.startswith('vpt-'):
                sh('/usr/sbin/groupdel', entry.gr_name, check=False)
                removed.append(f'group {entry.gr_name}')
    print(json.dumps({'removed': removed}))


# ── proofs ───────────────────────────────────────────────────────────────────────────────


class Report:
    def __init__(self):
        self.results: list[dict] = []

    def add(self, test: str, name: str, ok: bool, detail: str) -> None:
        self.results.append({'test': test, 'check': name, 'ok': bool(ok), 'detail': detail})
        print(f'  [{"PASS" if ok else "FAIL"}] {test} {name}: {detail}', flush=True)


def probe(slug: str, profile: str | None, checks: list[str], *, runtime: str = 'probe',
          cwd: str | None = None, env: dict | None = None, agent_id: int | None = None,
          work: tuple[str, int] | None = None) -> dict:
    workspace = f'{ROOT}/workspaces/home' if slug == 'home' else f'{ROOT}/workspaces/projects/{slug}'
    argv = ['run', '--slug', slug, '--runtime', runtime, '--cwd', cwd or workspace]
    if profile:
        argv += ['--profile', profile]
    for key, value in (env or {}).items():
        argv += ['--env', f'{key}={value}']
    if agent_id:
        argv += ['--agent-id', str(agent_id)]
    if work:
        argv += ['--kind', work[0], '--work-id', str(work[1])]
    done = client(argv + ['--', *checks], check=False)
    try:
        return json.loads(done.stdout.decode().strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {'_error': f'rc={done.returncode} out={done.stdout.decode()[-300:]} err={done.stderr.decode()[-300:]}'}


def keys() -> dict:
    path = os.path.expanduser('~wilhelmpa/agent-work/plan-isolation-proof/keys.json')
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def prove(args: argparse.Namespace) -> None:
    only = set(args.only.split(',')) if args.only else None
    report = Report()
    tests = [
        ('1', prove_1_egress_basic), ('2', prove_2_egress_blocks), ('3', prove_3_no_local_services),
        ('4', prove_4_no_foreign_files), ('5', prove_5_function), ('6', prove_6_launcher_refuses),
        ('7', prove_7_browser), ('M', prove_modes), ('P', prove_plan_socket), ('T', prove_terminal),
        ('G', prove_migration), ('U', prove_users), ('B', prove_browser_gateway),
    ]
    for number, function in tests:
        if only and number not in only:
            continue
        print(f'== {number}: {function.__doc__.strip().splitlines()[0]}', flush=True)
        try:
            function(report)
        except Exception as error:  # noqa: BLE001
            report.add(number, 'harness', False, f'{type(error).__name__}: {error}')
    failed = [r for r in report.results if not r['ok']]
    summary = {'passed': len(report.results) - len(failed), 'failed': len(failed), 'results': report.results}
    with open(f'{PROOF}/report.json', 'w', encoding='utf-8') as handle:
        json.dump(summary, handle, indent=2)
    out = os.path.expanduser('~wilhelmpa/agent-work/plan-isolation-proof/report.json')
    shutil.copyfile(f'{PROOF}/report.json', out)
    os.chown(out, uid('wilhelmpa'), gid('wilhelmpa'))
    print(f'== {summary["passed"]} passed, {summary["failed"]} failed')
    raise SystemExit(1 if failed else 0)


def expect(report: Report, test: str, results: dict, spec: str, want_ok: bool, contains: str | None = None) -> None:
    if '_error' in results:
        report.add(test, spec, False, results['_error'])
        return
    value = results.get(spec, {'ok': None, 'detail': 'missing'})
    ok = value['ok'] == want_ok and (contains is None or contains in value['detail'])
    report.add(test, spec, ok, value['detail'])


GATEWAY_LISTENER = (
    'import os, socket, sys\n'
    'path, answer, gid = sys.argv[1], sys.argv[2], int(sys.argv[3])\n'
    'if os.path.exists(path): os.unlink(path)\n'
    's = socket.socket(socket.AF_UNIX); s.bind(path); os.chown(path, -1, gid); os.chmod(path, 0o660); s.listen()\n'
    'while True:\n'
    '    c, _ = s.accept(); c.sendall(answer.encode() + b"\\n"); c.close()\n'
)


def gateway_listener(slug: str, answer: str) -> subprocess.Popen:
    directory = f'{RUN_GATEWAY}/{slug}'
    os.makedirs(directory, mode=0o750, exist_ok=True)
    os.chown(directory, uid('vpt-browser'), gid('vpt-agents'))
    os.chmod(directory, 0o750)
    return subprocess.Popen(['/usr/bin/python3', '-I', '-c', GATEWAY_LISTENER, f'{directory}/gateway.sock',
                             answer, str(gid('vpt-agents'))])


def prove_browser_gateway(report: Report) -> None:
    """The browser gateway: each unit reaches its own project's socket and no other, across a restart of the router."""
    os.makedirs(os.path.dirname(RUN_GATEWAY), mode=0o711, exist_ok=True)
    os.makedirs(RUN_GATEWAY, mode=0o711, exist_ok=True)
    listeners = {'alpha': gateway_listener('alpha', 'alpha'), 'beta': gateway_listener('beta', 'beta')}
    time.sleep(0.5)
    try:
        own = '/run/volition-agents/browser/gateway.sock'
        alpha = probe('alpha', 'alpha', [f'unixread:{own}', f'unix:{RUN_GATEWAY}/beta/gateway.sock',
                                         f'read:{RUN_GATEWAY}', f'read:{RUN_GATEWAY}/beta'])
        expect(report, 'B', alpha, f'unixread:{own}', True, 'alpha')
        expect(report, 'B', alpha, f'unix:{RUN_GATEWAY}/beta/gateway.sock', False)
        expect(report, 'B', alpha, f'read:{RUN_GATEWAY}', False)
        expect(report, 'B', alpha, f'read:{RUN_GATEWAY}/beta', False)
        beta = probe('beta', 'beta', [f'unixread:{own}'])
        expect(report, 'B', beta, f'unixread:{own}', True, 'beta')
        # A project without a browser (Home here): the unit starts all the same, and has none.
        home = probe('home', None, ['whoami', f'unix:{own}'])
        expect(report, 'B', home, 'whoami', True)
        expect(report, 'B', home, f'unix:{own}', False)
        # The router restarts while an agent runs: its unit reaches the new socket.
        import threading  # noqa: PLC0415
        outcome: dict = {}
        worker = threading.Thread(target=lambda: outcome.update(probe('alpha', 'alpha', [f'unixtwice:{own},4'])))
        worker.start()
        time.sleep(2)
        listeners['alpha'].kill()
        listeners['alpha'].wait()
        listeners['alpha'] = gateway_listener('alpha', 'alpha-restarted')
        worker.join()
        expect(report, 'B', outcome, f'unixtwice:{own},4', True, 'alpha|alpha-restarted')
    finally:
        for listener in listeners.values():
            listener.kill()
        shutil.rmtree(os.path.dirname(RUN_GATEWAY), ignore_errors=True)


def prove_1_egress_basic(report: Report) -> None:
    """Direct internet fails, the same request through the egress proxy answers 200."""
    results = probe('alpha', 'alpha', ['curl:--noproxy,*,https://example.com', 'curl:https://example.com',
                                       'tcp:93.184.215.14,443', 'whoami'])
    expect(report, '1', results, 'curl:--noproxy,*,https://example.com', False)
    expect(report, '1', results, 'curl:https://example.com', True, 'http=200')
    expect(report, '1', results, 'tcp:93.184.215.14,443', False)
    who = json.loads(results.get('whoami', {}).get('detail', '{}') or '{}')
    report.add('1', 'runs as the project user', who.get('uid') == uid('vpt-alpha'), json.dumps(who))


def prove_2_egress_blocks(report: Report) -> None:
    """Through the proxy: loopback, LAN, host, link-local, IPv6 loopback and a name for 127.0.0.1 are refused."""
    targets = ['http://127.0.0.1/', 'http://192.168.122.1/', 'http://10.0.0.1/', 'http://169.254.169.254/',
               'http://[::1]/', 'http://localtest.me/', 'https://127.0.0.1/', 'http://192.168.2.220/',
               'http://kingston-server.local/', 'http://0.0.0.0/', 'http://[::ffff:127.0.0.1]/',
               'http://100.64.0.1/', 'http://2130706433/']
    results = probe('alpha', 'alpha', [f'curl:{t}' for t in targets])
    for target in targets:
        expect(report, '2', results, f'curl:{target}', False)


def prove_3_no_local_services(report: Report) -> None:
    """No CDP port, router, code-server, dashboard, Postgres, Redis or Postgres socket."""
    ports = [19201, 19202, 19203, 19204, 9222, 6082, 8443, 8444, 9119, 5432, 6379, 3001, 18800, 16080, 8384]
    checks = [f'tcp:127.0.0.1,{port}' for port in ports]
    checks += ['tcp:192.168.122.58,80', 'tcp:192.168.122.1,22', 'tcp:::1,5432']
    checks += [f'curl:http://127.0.0.1:{port}/' for port in (8443, 6082, 9222)]
    checks += ['unix:/run/postgresql/.s.PGSQL.5432',
               'unix:/var/run/postgresql/.s.PGSQL.5432', 'unix:/run/dbus/system_bus_socket',
               'unix:/run/systemd/private', 'unix:/run/volition-terminal/home.sock',
               'unix:/var/lib/volition/hermes/.local/share/code-server/code-server-ipc.sock',
               'exec:psql,-h,/var/run/postgresql,-U,postgres,-c,select 1',
               'exec:psql,-h,/run/postgresql,-c,select 1']
    results = probe('alpha', 'alpha', checks)
    for spec in checks:
        expect(report, '3', results, spec, False)


def prove_4_no_foreign_files(report: Report) -> None:
    """Secrets, foreign workspaces, profiles, vaults, provisioning and browser state are unreadable."""
    foreign = ['/etc/volition', '/srv/volition/secrets', '/srv/volition/workspaces/projects',
               '/srv/volition/vault', '/var/lib/volition/provisioning', '/var/lib/volition/project-browser',
               '/var/lib/volition/hermes', '/var/lib/volition/hermes/auth.json', '/var/lib/volition/hermes/run/agents',
               f'{ROOT}/workspaces/projects/beta', f'{ROOT}/workspaces/projects/beta/secret-beta.txt',
               f'{ROOT}/hermes/profiles/beta', f'{ROOT}/hermes/profiles/beta/MEMORY.md', f'{ROOT}/hermes/auth.json',
               f'{ROOT}/vault/Projects/BETA', f'{ROOT}/vault/Private', f'{ROOT}/vault/Home', f'{ROOT}/secrets/token',
               f'{ROOT}/project-browser/alpha/Cookies', f'{ROOT}/provisioning/projects/alpha.json',
               '/home/wilhelmpa', '/root', '/proc/1/environ', '/var/log/syslog']
    own = [f'{ROOT}/workspaces/projects/alpha/secret-alpha.txt', f'{ROOT}/hermes/profiles/alpha/MEMORY.md',
           f'{ROOT}/vault/Projects/ALPHA/note-alpha.md']
    results = probe('alpha', 'alpha', [f'read:{p}' for p in foreign + own] +
                    [f'write:{ROOT}/workspaces/projects/alpha/written.txt',
                     f'write:{ROOT}/vault/Projects/ALPHA/written.md', 'write:/usr/local/bin/x',
                     'write:/etc/x'])
    for path in foreign:
        expect(report, '4', results, f'read:{path}', False)
    for path in own:
        expect(report, '4', results, f'read:{path}', True)
    expect(report, '4', results, f'write:{ROOT}/workspaces/projects/alpha/written.txt', True)
    expect(report, '4', results, f'write:{ROOT}/vault/Projects/ALPHA/written.md', True)
    expect(report, '4', results, 'write:/usr/local/bin/x', False)
    expect(report, '4', results, 'write:/etc/x', False)
    # The profile of another agent of the same project is not in the unit either.
    results = probe('alpha', 'alpha_7', [f'read:{ROOT}/hermes/profiles/alpha/MEMORY.md',
                                         f'read:{ROOT}/hermes/profiles/alpha_7/MEMORY.md'], agent_id=7)
    expect(report, '4', results, f'read:{ROOT}/hermes/profiles/alpha/MEMORY.md', False)
    expect(report, '4', results, f'read:{ROOT}/hermes/profiles/alpha_7/MEMORY.md', True)
    # Home reads every project's vault folder, writes its own, and nothing else.
    results = probe('home', 'home', [f'read:{ROOT}/vault/Projects/ALPHA/note-alpha.md',
                                     f'read:{ROOT}/vault/Projects/BETA/note-beta.md', f'read:{ROOT}/vault/Home/home.md',
                                     f'write:{ROOT}/vault/Home/written.md', f'write:{ROOT}/vault/Projects/ALPHA/x.md',
                                     f'read:{ROOT}/vault/Private', f'read:{ROOT}/workspaces/projects/alpha'])
    expect(report, '4', results, f'read:{ROOT}/vault/Projects/ALPHA/note-alpha.md', True)
    expect(report, '4', results, f'read:{ROOT}/vault/Projects/BETA/note-beta.md', True)
    expect(report, '4', results, f'read:{ROOT}/vault/Home/home.md', True)
    expect(report, '4', results, f'write:{ROOT}/vault/Home/written.md', True)
    expect(report, '4', results, f'write:{ROOT}/vault/Projects/ALPHA/x.md', False)
    expect(report, '4', results, f'read:{ROOT}/vault/Private', False)
    expect(report, '4', results, f'read:{ROOT}/workspaces/projects/alpha', False)
    # Outside any unit, on the host, the project users cannot read each other's files either.
    done = sh('/usr/sbin/runuser', '-u', 'vpt-alpha', '--', 'cat', f'{ROOT}/workspaces/projects/beta/secret-beta.txt', check=False)
    report.add('4', 'host: vpt-alpha reads beta workspace', done.returncode != 0,
               (done.stderr or b'').decode().strip()[:120])
    done = sh('/usr/sbin/runuser', '-u', 'vpt-alpha', '--', 'cat', f'{ROOT}/hermes/profiles/beta/MEMORY.md', check=False)
    report.add('4', 'host: vpt-alpha reads beta profile', done.returncode != 0,
               (done.stderr or b'').decode().strip()[:120])


def prove_5_function(report: Report) -> None:
    """Hermes run end to end, Claude Code and Codex reach their API through the proxy, stop ends the unit."""
    from proof_function import run_function_proofs  # noqa: PLC0415

    run_function_proofs(report, probe, client, keys, load_state())


def prove_6_launcher_refuses(report: Report) -> None:
    """The launcher refuses a foreign slug, a path outside, an unknown runtime, properties and other users."""
    workspace = f'{ROOT}/workspaces/projects/alpha'

    def attempt(request: dict, user: str = 'vpt-hermes', socket_path: str = LAUNCH_SOCKET) -> str:
        line = json.dumps({'v': 1, **request}).encode() + b'\n'
        script = ('import socket,sys,struct,os\n'
                  's=socket.socket(socket.AF_UNIX)\n'
                  f's.connect({socket_path!r})\n'
                  's.sendall(sys.stdin.buffer.read())\n'
                  'h=s.recv(5)\n'
                  'k,n=struct.unpack(">BI",h)\n'
                  'd=b""\n'
                  'while len(d)<n:\n  c=s.recv(n-len(d))\n  if not c: break\n  d+=c\n'
                  'print(hex(k), d.decode())\n')
        done = sh('/usr/sbin/runuser', '-u', user, '--', '/usr/bin/python3', '-I', '-c', script, check=False, input=line)
        out = done.stdout.decode().strip()
        if out:
            return out
        errors = done.stderr.decode().strip().splitlines()
        return errors[-1] if errors else f'rc={done.returncode}'

    base = {'op': 'run', 'slug': 'alpha', 'profile': 'alpha', 'runtime': 'probe', 'args': ['whoami'],
            'env': {}, 'cwd': workspace}
    cases = [
        ('foreign slug', {**base, 'slug': 'beta'}, 'profile'),
        ('foreign profile', {**base, 'profile': 'beta'}, 'profile'),
        ('unprovisioned slug', {**base, 'slug': 'gamma', 'profile': 'gamma'}, 'not provisioned'),
        ('path outside', {**base, 'cwd': '/etc'}, 'outside'),
        ('path escape', {**base, 'cwd': f'{workspace}/../beta'}, 'plain absolute path'),
        ('unknown runtime', {**base, 'runtime': 'bash'}, 'unknown runtime'),
        ('properties', {**base, 'properties': {'User': 'root'}}, 'unexpected fields'),
        ('user field', {**base, 'user': 'root'}, 'unexpected fields'),
        ('reserved env', {**base, 'env': {'HOME': '/root'}}, 'may not set'),
        ('proxy env', {**base, 'env': {'https_proxy': 'http://evil'}}, 'may not set'),
        ('ld_preload', {**base, 'env': {'LD_PRELOAD': '/tmp/x.so'}}, 'may not set'),
        ('bad slug', {**base, 'slug': '../root'}, 'invalid project slug'),
    ]
    for name, request, needle in cases:
        answer = attempt(request)
        report.add('6', name, answer.startswith('0x14') and needle in answer, answer[:200])
    answer = attempt({'op': 'ping'}, user='vpt-other')
    report.add('6', 'other user, runner socket', 'Permission denied' in answer or 'PermissionError' in answer, answer[:200])
    answer = attempt({'op': 'ping'}, user='vpt-alpha')
    report.add('6', 'agent user, runner socket', 'Permission denied' in answer or 'PermissionError' in answer, answer[:200])
    answer = attempt(base, user='vpt-other', socket_path=OPEN_SOCKET)
    report.add('6', 'other user, open socket', answer.startswith('0x14') and 'caller' in answer, answer[:200])
    answer = attempt(base, user='vpt-alpha', socket_path=OPEN_SOCKET)
    report.add('6', 'agent user, open socket', answer.startswith('0x14') and 'caller' in answer, answer[:200])
    answer = attempt({'op': 'ping'})
    report.add('6', 'runner user is accepted', answer.startswith('0x15'), answer[:200])


def prove_7_browser(report: Report) -> None:
    """Browser units run as the browser user and keep their logins through the migration."""
    from proof_browser import run_browser_proofs, run_browser_state_proofs  # noqa: PLC0415

    run_browser_proofs(report, sh, ROOT, load_state())
    run_browser_state_proofs(report, sh, ROOT)


def prove_modes(report: Report) -> None:
    """The three network modes and a per-agent mode are enforced by the egress proxy."""
    from proof_function import run_mode_proofs  # noqa: PLC0415

    run_mode_proofs(report, probe, keys, load_state())


def prove_plan_socket(report: Report) -> None:
    """The Plan API accepts only the key of an agent of the unit's project."""
    from proof_function import run_plan_socket_proofs  # noqa: PLC0415

    run_plan_socket_proofs(report, probe, keys)


def prove_terminal(report: Report) -> None:
    """The project terminal runs as the project user in the same sandbox."""
    from proof_function import run_terminal_proofs  # noqa: PLC0415

    run_terminal_proofs(report, sh, ISO, LAUNCH_SOCKET, ROOT)


def prove_migration(report: Report) -> None:
    """The migration hands each project its files, copies Home's state and follows no link."""
    state = load_state()
    after = state.get('afterDryRun', {})
    report.add('G', 'dry run changes nothing', after.get('workspaceFileUid') == uid('vpt-hermes')
               and after.get('homeProfileExists') is False, json.dumps(after))
    with open(f'{PROOF}/migrate-dry-run.txt', encoding='utf-8') as handle:
        dry = handle.read()
    report.add('G', 'dry run lists each change', dry.count('would chown') > 5 and 'would setfacl' in dry,
               f'{dry.count("would chown")} chown, {dry.count("would setfacl")} setfacl lines')
    with open(f'{PROOF}/migrate-again.txt', encoding='utf-8') as handle:
        again = json.loads(next(line for line in handle.read().splitlines() if line.startswith('{"changes"')))
    report.add('G', 'second run changes nothing', again['changes'] == 0, json.dumps(again)[:200])
    info = os.stat(f'{ROOT}/workspaces/projects/alpha/secret-alpha.txt')
    report.add('G', 'workspace file belongs to the project', info.st_uid == uid('vpt-alpha'), f'uid={info.st_uid}')
    info = os.stat(f'{ROOT}/hermes/profiles/alpha_7/MEMORY.md')
    report.add('G', 'profile belongs to the project', info.st_uid == uid('vpt-alpha'), f'uid={info.st_uid}')
    info = os.stat(f'{ROOT}/hermes/auth.json')
    acl = sh('getfacl', '-cp', f'{ROOT}/hermes/auth.json').stdout.decode()
    report.add('G', 'hard-linked runner token untouched', info.st_uid == uid('vpt-hermes') and 'vpt-alpha' not in acl,
               f'uid={info.st_uid} links={info.st_nlink} acl={acl.strip().replace(chr(10), " ")}')
    with open(f'{PROOF}/migrate-apply.txt', encoding='utf-8') as handle:
        applied = handle.read()
    report.add('G', 'hard link reported', 'stolen-auth.json: hard link' in applied, 'skipped list names it')
    info = os.stat(f'{ROOT}/secrets/token')
    report.add('G', 'link target untouched', info.st_uid == 0 and oct(info.st_mode & 0o777) == '0o600', f'uid={info.st_uid}')
    done = sh('/usr/sbin/runuser', '-u', 'vpt-alpha', '--', 'cat', f'{ROOT}/workspaces/projects/alpha/stolen-auth.json',
              check=False)
    report.add('G', 'project cannot read the hard link', done.returncode != 0, (done.stderr or b'').decode().strip()[:120])
    home = f'{ROOT}/hermes/profiles/home'
    copied = {name: os.path.exists(os.path.join(home, name)) for name in
              ('SOUL.md', 'memories/MEMORY.md', 'state.db', 'run/agents', 'auth.json')}
    report.add('G', "Home's state copied, keys left behind",
               copied == {'SOUL.md': True, 'memories/MEMORY.md': True, 'state.db': True, 'run/agents': False,
                          'auth.json': False} and os.stat(home).st_uid == uid('vpt-home'), json.dumps(copied))
    import sqlite3  # noqa: PLC0415
    with sqlite3.connect(f'file:{home}/state.db?mode=ro', uri=True) as connection:
        rows = connection.execute('select id from sessions').fetchall()
    report.add('G', "Home's sessions carried over", rows == [('home-session-1',)], str(rows))
    results = probe('home', 'home', [f'read:{home}/SOUL.md', f'read:{home}/state.db'])
    expect(report, 'G', results, f'read:{home}/SOUL.md', True)
    info = os.stat(f'{ROOT}/project-browser/alpha/Cookies')
    report.add('G', 'browser state belongs to the browser user', info.st_uid == uid('vpt-browser'), f'uid={info.st_uid}')


def prove_users(report: Report) -> None:
    """The launcher creates a project user with a UID that is never given out twice."""
    registry = f'{ROOT}/provisioning/projects/gamma.json'
    write(registry, json.dumps({'schemaVersion': 1, 'slug': 'gamma', 'project': {'id': 3, 'key': 'GAMMA'}}),
          'vpt-hermes', 'vpt-hermes', 0o600)
    mkdir(f'{ROOT}/workspaces/projects/gamma', 'vpt-hermes', 'vpt-hermes', 0o750)
    try:
        first = json.loads(client(['ensure-project-user', 'gamma', '--profile', 'gamma']).stdout)
        report.add('U', 'creates the user', first.get('created') is True and first['user'] == 'vpt-gamma', json.dumps(first))
        info = os.stat(f'{ROOT}/workspaces/projects/gamma')
        acl = sh('getfacl', '-cp', f'{ROOT}/workspaces/projects/gamma').stdout.decode()
        report.add('U', 'workspace to the user, runner and readers by ACL',
                   info.st_uid == first['uid'] and 'user:vpt-hermes:rwx' in acl and 'default:user:vpt-hermes:rwx' in acl
                   and 'group:vpt-hermes:r-x' in acl, acl.strip().replace('\n', ' ')[:300])
        again = json.loads(client(['ensure-project-user', 'gamma']).stdout)
        report.add('U', 'second call changes nothing', again.get('created') is False and again['uid'] == first['uid'],
                   json.dumps(again))
        removed = json.loads(client(['remove-project-user', 'gamma']).stdout)
        report.add('U', 'removes the user', removed.get('removed') is True, json.dumps(removed))
        recreated = json.loads(client(['ensure-project-user', 'gamma']).stdout)
        report.add('U', 'a new user gets a new UID', recreated['uid'] != first['uid'],
                   f'first={first["uid"]} then={recreated["uid"]}')
        home = client(['ensure-project-user', 'root'], check=False)
        report.add('U', 'refuses a reserved name', home.returncode != 0 and b'invalid' in home.stdout, home.stdout.decode()[:120])
    finally:
        client(['remove-project-user', 'gamma'], check=False)
        os.unlink(registry)


def main() -> None:
    if os.geteuid() != 0:
        raise SystemExit('run as root')
    sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    s = commands.add_parser('setup')
    s.add_argument('--source', required=True)
    s.add_argument('--plan-port', type=int, default=3900)
    s.add_argument('--model-port', type=int, default=80)
    commands.add_parser('start')
    p = commands.add_parser('prove')
    p.add_argument('--only')
    commands.add_parser('stop')
    t = commands.add_parser('teardown')
    t.add_argument('--users', action='store_true')
    t.add_argument('--all', action='store_true', help='the test Plan API too')
    args = parser.parse_args()
    {'setup': setup, 'start': start, 'prove': prove, 'stop': stop, 'teardown': teardown}[args.command](args)


if __name__ == '__main__':
    main()
