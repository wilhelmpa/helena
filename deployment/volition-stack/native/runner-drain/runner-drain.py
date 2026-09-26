#!/usr/bin/env python3
"""Drain only the native Hermes runner; operator deadlines never stop its work."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import time

UNIT = 'volition-hermes-runner.service'
OVERRIDE = b'[Service]\nKillSignal=SIGINT\nTimeoutStopSec=infinity\nSendSIGKILL=no\nSendSIGHUP=no\nKillMode=mixed\n'
PROPERTIES = ('LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlPID', 'InvocationID',
              'ControlGroup', 'Job', 'Result', 'ExecMainCode', 'ExecMainStatus', 'FragmentPath',
              'DropInPaths', 'KillSignal', 'TimeoutStopUSec', 'SendSIGKILL', 'SendSIGHUP', 'KillMode',
              'ExecStop', 'ExecStopPost')


class Refuse(RuntimeError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def regular(path, uid, mode=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != uid:
            raise Refuse('Unexpected file ownership or type: ' + str(path))
        if mode is not None and stat.S_IMODE(info.st_mode) != mode:
            raise Refuse('Unexpected file mode: ' + str(path))
        with os.fdopen(os.dup(fd), 'rb') as stream:
            return stream.read()
    finally:
        os.close(fd)


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private_dir(path, uid, mode=0o700):
    path.mkdir(mode=mode, parents=True, exist_ok=True)
    for parent in (path, *path.parents):
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, uid):
            raise Refuse('Unsafe parent: ' + str(parent))
        if info.st_mode & 0o022 and parent != Path('/tmp'):
            raise Refuse('Writable parent: ' + str(parent))
    if path.stat().st_uid != uid or stat.S_IMODE(path.stat().st_mode) != mode:
        raise Refuse('Unexpected directory ownership or mode: ' + str(path))


def durable(path, data, uid, replace=False, mode=0o600):
    if path.exists() or path.is_symlink():
        regular(path, uid, mode)
        if not replace:
            raise Refuse('Refusing to overwrite ' + str(path))
    temporary = path.with_name(path.name + '.writing')
    if temporary.exists() or temporary.is_symlink():
        if regular(temporary, uid, mode) != data:
            raise Refuse('Interrupted write differs; inspect ' + str(temporary))
    else:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        try:
            os.fchmod(fd, mode)
            with os.fdopen(os.dup(fd), 'wb') as stream:
                stream.write(data)
                stream.flush()
            os.fsync(fd)
        finally:
            os.close(fd)
    if replace:
        os.replace(temporary, path)
    else:
        os.link(temporary, path, follow_symlinks=False)
        temporary.unlink()
    sync_dir(path.parent)


class System:
    def run(self, *args):
        result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=30, check=False)
        if result.returncode:
            raise Refuse('Command failed: ' + args[0] + ' ' + args[1])
        return result.stdout.strip()

    def show(self):
        output = self.run('systemctl', 'show', UNIT, '--all', '--no-pager',
                          '--property=' + ','.join(PROPERTIES))
        result = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
        for key in ('ExecStop', 'ExecStopPost'):
            result.setdefault(key, '')
        if any(key not in result for key in PROPERTIES) or result['LoadState'] != 'loaded':
            raise Refuse('Runner unit metadata unavailable')
        return result

    def start_sources_idle(self):
        for unit in ('volition-hermes-bootstrap.timer', 'volition-hermes-bootstrap.service'):
            output = self.run('systemctl', 'show', unit, '--all', '--no-pager',
                              '--property=LoadState,ActiveState,Job')
            value = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
            if (value.get('LoadState') not in ('loaded', 'not-found')
                    or value.get('ActiveState') != 'inactive' or value.get('Job') not in ('', '0')):
                return False
        return True

    def identity(self, pid):
        text = Path(f'/proc/{pid}/stat').read_text()
        return text[text.rfind(') ') + 2:].split()[19]

    def empty_group(self, group):
        if not group.startswith('/') or '..' in Path(group).parts:
            raise Refuse('Invalid runner cgroup')
        root = Path('/sys/fs/cgroup') / group.lstrip('/')
        if not root.exists():
            return True
        return all(not path.read_text().strip() for path in root.rglob('cgroup.procs'))


class Drain:
    def __init__(self, system, state_dir=Path('/var/lib/volition/deploy/runner-drain'),
                 dropin=Path('/run/systemd/system/' + UNIT + '.d/90-helena-deploy-drain.conf'),
                 capability=Path('/var/lib/volition/hermes/run/deploy-drain-status.json'),
                 live=Path('/srv/volition/source/plan'), uid=0, runner_uid=None):
        self.system, self.root, self.dropin = system, state_dir, dropin
        self.capability, self.live, self.uid = capability, live, uid
        self.runner_uid = pwd.getpwnam('volition-hermes').pw_uid if runner_uid is None else runner_uid
        self.file = state_dir / 'state.json'
        self.backup = state_dir / 'override.backup'
        self.bundle = live / 'packages/runner/dist/cli.js'
        self.state = None

    def load(self):
        if self.file.exists() or self.file.is_symlink():
            self.state = json.loads(regular(self.file, self.uid, 0o600))
            if (not isinstance(self.state, dict) or self.state.get('version') != 1
                    or self.state.get('unit') != UNIT
                    or self.state.get('phase') not in ('prepared', 'stop-requested', 'waiting', 'drained', 'ready', 'released', 'complete')
                    or not re.fullmatch(r'[0-9a-f]{40}', self.state.get('target', ''))):
                raise Refuse('Unrecognized drain state')
        return self.state

    def save(self, phase):
        self.state['phase'] = phase
        durable(self.file, (json.dumps(self.state, sort_keys=True) + '\n').encode(),
                self.uid, replace=True)

    def unit_hashes(self, snapshot):
        paths = [snapshot['FragmentPath'], *snapshot['DropInPaths'].split()]
        return {name: digest(regular(Path(name), self.uid)) for name in paths
                if Path(name) != self.dropin}

    def own_override(self):
        expected = regular(self.backup, self.uid, 0o600)
        if expected != OVERRIDE or digest(expected) != self.state['overrideHash']:
            raise Refuse('Drain override backup changed')
        if regular(self.dropin, self.uid, 0o644) != expected:
            raise Refuse('Reserved runtime override changed; left untouched')

    def read_capability(self, snapshot):
        return json.loads(regular(self.capability, self.runner_uid, 0o600))

    def capability_matches(self, snapshot, phases=('running', 'draining')):
        capability = self.read_capability(snapshot)
        return (capability.get('version') == 1 and str(capability.get('pid')) == snapshot['MainPID']
                and capability.get('startTicks') == self.system.identity(snapshot['MainPID'])
                and capability.get('phase') in phases)

    def held_identity(self, snapshot):
        return (snapshot['InvocationID'] == self.state['invocation']
                and snapshot['MainPID'] == self.state['pid']
                and self.system.identity(snapshot['MainPID']) == self.state['startTicks'])

    def drained(self, snapshot):
        return (snapshot['InvocationID'] == self.state['invocation']
                and snapshot['ActiveState'] == 'inactive' and snapshot['SubState'] == 'dead'
                and snapshot['MainPID'] == '0' and snapshot['ControlPID'] == '0'
                and snapshot['Job'] in ('', '0') and snapshot['Result'] == 'success'
                and snapshot['ExecMainCode'] in ('1', 'exited')
                and snapshot['ExecMainStatus'] == '0'
                and self.system.empty_group(self.state['group']))

    def quiet_start_sources(self):
        if not self.system.start_sources_idle():
            raise Refuse('Runner bootstrap timer/service is active or unknown; Root must hold its start triggers')

    def drain(self, target, seconds, before=None):
        self.quiet_start_sources()
        if not re.fullmatch(r'[0-9a-f]{40}', target):
            raise Refuse('A full tested target commit is required')
        current = self.system.show()
        self.load()
        completed = bool(self.state and self.state['phase'] == 'complete')
        if completed:
            archive = self.root / ('completed-' + digest(regular(self.file, self.uid, 0o600)) + '.json')
            data = regular(self.file, self.uid, 0o600)
            if archive.exists():
                if regular(archive, self.uid, 0o600) != data:
                    raise Refuse('Completed drain archive changed')
            else:
                durable(archive, data, self.uid)
            if self.dropin.exists() or self.dropin.is_symlink():
                raise Refuse('Completed drain unexpectedly retains an override')
            if regular(self.backup, self.uid, 0o600) != OVERRIDE:
                raise Refuse('Completed drain backup changed')
            self.state = None
        if self.state is None:
            if self.dropin.exists() or self.dropin.is_symlink() or (self.backup.exists() and not completed):
                raise Refuse('Reserved drain files already exist; refusing foreign state')
            if current['ActiveState'] != 'active' or current['SubState'] != 'running':
                raise Refuse('Bootstrap requires Root to install and start the capable runner first')
            capability = self.read_capability(current)
            if not self.capability_matches(current):
                raise Refuse('Running runner has no matching safe-drain capability; bootstrap separately')
            if not re.fullmatch(r'[0-9a-f]{32}', current['InvocationID']):
                raise Refuse('Runner invocation identity unavailable')
            checkout = self.system.run('git', '-c', 'safe.directory=' + str(self.live), '-C', str(self.live), 'rev-parse', 'HEAD')
            if before is not None and checkout != before:
                raise Refuse('Checkout already changed before drain; preserve current work and inspect deployment')
            self.state = {
                'version': 1, 'unit': UNIT, 'target': target, 'checkoutBefore': checkout, 'pid': current['MainPID'],
                'startTicks': capability['startTicks'], 'invocation': current['InvocationID'],
                'group': current['ControlGroup'], 'unitHashes': self.unit_hashes(current),
                'bundleBefore': digest(regular(self.bundle, self.uid)),
                'overrideHash': digest(OVERRIDE), 'originalOverride': None,
            }
            if not completed:
                durable(self.backup, OVERRIDE, self.uid)
            self.save('prepared')
        if self.state['target'] != target:
            raise Refuse('A different target already owns this drain; finish that deployment first')
        phase = self.state['phase']
        if phase in ('prepared', 'stop-requested', 'waiting') and (
                self.system.run('git', '-c', 'safe.directory=' + str(self.live), '-C', str(self.live), 'rev-parse', 'HEAD') != self.state['checkoutBefore']
                or digest(regular(self.bundle, self.uid)) != self.state['bundleBefore']):
            raise Refuse('Checkout or bundle changed before drain completed')
        if phase == 'drained':
            self.own_override()
            checkout = self.system.run('git', '-c', 'safe.directory=' + str(self.live), '-C', str(self.live), 'rev-parse', 'HEAD')
            current = self.system.show()
            hashes = self.unit_hashes(current)
            allowed = dict(self.state['unitHashes'])
            if checkout == target:
                candidate = self.live / 'deployment/volition-stack/native/systemd' / UNIT
                allowed[current['FragmentPath']] = digest(candidate.read_bytes())
            if (checkout not in (self.state['checkoutBefore'], target) or not self.drained(current)
                    or hashes not in (self.state['unitHashes'], allowed)):
                raise Refuse('Drained deployment changed unexpectedly; no stop resent')
            return
        if phase in ('ready', 'released', 'complete'):
            raise Refuse('Drain already passed; use the recorded activation state')
        if phase == 'prepared':
            private_dir(self.dropin.parent, self.uid, 0o755)
            if not self.dropin.exists() and not self.dropin.is_symlink():
                durable(self.dropin, OVERRIDE, self.uid, mode=0o644)
            self.own_override()
            self.system.run('systemctl', 'daemon-reload')
            current = self.system.show()
            if (current['ActiveState'] != 'active' or current['SubState'] != 'running'
                    or current['Job'] not in ('', '0') or current['ControlPID'] != '0'
                    or not self.held_identity(current) or not self.capability_matches(current, ('running',))
                    or self.unit_hashes(current) != self.state['unitHashes']
                    or digest(regular(self.bundle, self.uid)) != self.state['bundleBefore']
                    or current['KillSignal'] not in ('2', 'SIGINT')
                    or current['TimeoutStopUSec'] != 'infinity' or current['SendSIGKILL'] != 'no'
                    or current['SendSIGHUP'] != 'no' or current['KillMode'] != 'mixed'
                    or current['ExecStop'] or current['ExecStopPost']):
                raise Refuse('Effective runner identity or drain policy changed; no stop sent')
            self.quiet_start_sources()
            self.save('stop-requested')
            self.system.run('systemctl', 'stop', '--no-block', UNIT)
            self.save('waiting')
        deadline = time.monotonic() + seconds
        while True:
            self.quiet_start_sources()
            self.own_override()
            current = self.system.show()
            if self.unit_hashes(current) != self.state['unitHashes']:
                raise Refuse('Unit files changed during drain')
            if current['InvocationID'] != self.state['invocation']:
                raise Refuse('Runner invocation changed; no signal sent')
            if self.drained(current):
                self.save('drained')
                return
            if current['MainPID'] != '0' and not self.held_identity(current):
                raise Refuse('Runner invocation changed; no signal sent')
            if current['ActiveState'] == 'active' and current['Job'] in ('', '0'):
                raise Refuse('Stop dispatch is unconfirmed; no repeat signal. Inspect recorded invocation')
            if time.monotonic() >= deadline:
                raise Refuse('Drain still running; deployment unchanged, runtime override retained. '
                             'Repeat drain for this target to observe completion; no signal is resent')
            time.sleep(0.2)

    def ready(self, target):
        self.quiet_start_sources()
        self.load()
        if not self.state or self.state['target'] != target or self.state['phase'] not in ('drained', 'ready'):
            raise Refuse('This target has not drained')
        self.own_override()
        current = self.system.show()
        if not self.drained(current) or self.system.run('git', '-c', 'safe.directory=' + str(self.live), '-C', str(self.live), 'rev-parse', 'HEAD') != target:
            raise Refuse('Runner is not drained or checkout does not match the tested target')
        hashes = self.unit_hashes(current)
        if self.state['phase'] == 'ready':
            if (hashes != self.state['readyUnitHashes']
                    or digest(regular(self.bundle, self.uid)) != self.state['readyBundleHash']):
                raise Refuse('Ready bundle or unit changed; refusing to rebind approval')
            return
        previous = self.state['unitHashes']
        fragment = current['FragmentPath']
        candidate = self.live / 'deployment/volition-stack/native/systemd' / UNIT
        allowed = dict(previous)
        allowed[fragment] = digest(candidate.read_bytes())
        if hashes != previous and hashes != allowed:
            raise Refuse('Unreviewed unit/drop-in change before activation')
        self.state['readyUnitHashes'] = hashes
        self.state['readyBundleHash'] = digest(regular(self.bundle, self.uid))
        self.save('ready')

    def activate(self, target):
        self.quiet_start_sources()
        self.load()
        if not self.state or self.state['target'] != target or self.state['phase'] not in ('ready', 'released', 'complete'):
            raise Refuse('Target must be explicitly marked ready after deployment')
        if (self.system.run('git', '-c', 'safe.directory=' + str(self.live), '-C', str(self.live), 'rev-parse', 'HEAD') != target
                or digest(regular(self.bundle, self.uid)) != self.state['readyBundleHash']):
            raise Refuse('Ready checkout or bundle changed')
        current = self.system.show()
        if self.unit_hashes(current) != self.state['readyUnitHashes']:
            raise Refuse('Ready unit/drop-in files changed')
        if self.state['phase'] == 'ready':
            if not self.drained(current):
                raise Refuse('Runner is no longer drained; no activation')
            self.own_override()
            self.save('released')
        if self.dropin.exists() or self.dropin.is_symlink():
            self.own_override()
            if not self.drained(current):
                raise Refuse('Runner must remain drained while removing its override')
            self.dropin.unlink()
            sync_dir(self.dropin.parent)
        self.system.run('systemctl', 'daemon-reload')
        self.system.run('systemctl', 'start', UNIT)
        deadline = time.monotonic() + 30
        while True:
            started = self.system.show()
            try:
                ready = (started['ActiveState'] == 'active' and started['SubState'] == 'running'
                         and started['InvocationID'] != self.state['invocation']
                         and self.capability_matches(started, ('running',)))
            except (OSError, ValueError):
                ready = False
            if ready:
                self.state['startedInvocation'] = started['InvocationID']
                self.save('complete')
                return
            if time.monotonic() >= deadline:
                raise Refuse('New runner capability not ready; no kill, activation state retained')
            time.sleep(0.2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('drain', 'ready', 'activate', 'status'))
    parser.add_argument('--target')
    parser.add_argument('--before')
    parser.add_argument('--deadline-seconds', type=int, default=120)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise Refuse('Run through the reviewed Root deployment, never as an agent')
    controller = Drain(System())
    private_dir(controller.root, 0)
    lock = os.open(controller.root / 'lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        regular(controller.root / 'lock', 0, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'status':
            state = controller.load()
            print(json.dumps({key: state[key] for key in ('phase', 'target', 'pid', 'invocation')} if state else {'phase': 'none'}))
        elif args.action == 'drain':
            if not 1 <= args.deadline_seconds <= 7200:
                raise Refuse('Operator deadline must be 1..7200 seconds')
            if not args.before or not re.fullmatch(r'[0-9a-f]{40}', args.before):
                raise Refuse('The prior deployed commit is required for drain')
            controller.drain(args.target or '', args.deadline_seconds, args.before)
        elif args.action == 'ready':
            controller.ready(args.target)
        else:
            controller.activate(args.target)
    finally:
        os.close(lock)


if __name__ == '__main__':
    try:
        main()
    except (Refuse, OSError, ValueError, subprocess.TimeoutExpired) as error:
        raise SystemExit('runner-drain: ' + str(error)) from None
