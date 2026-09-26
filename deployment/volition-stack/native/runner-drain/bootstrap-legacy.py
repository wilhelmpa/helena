#!/usr/bin/env python3
"""One-time, pinned legacy runner drain. Never replaces a bundle or fast-forwards source."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

spec = importlib.util.spec_from_file_location('runner_drain', Path(__file__).with_name('runner-drain.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

# Exact CLI source at the reviewed e032/763 release, which has no descriptor-reload timer.
LEGACY_CLI_SHA256 = 'ae24a1c10ce69f3038bbb563d40ac8ef6e0c2018385aea458f933a71ae55d0ef'
INFLIGHT_SQL = """SELECT json_build_object(
'runs',(SELECT count(*) FROM agent_run WHERE status='pending' AND attempts>0),
'chats',(SELECT count(*) FROM agent_chat_message WHERE role='assistant' AND status='streaming'),
'claimed_pending_chats',(SELECT count(*) FROM agent_chat_message WHERE role='assistant' AND status='pending' AND attempts>0),
'reflections',(SELECT count(*) FROM helena_chat_reflection WHERE status='pending' AND claimed_at IS NOT NULL),
'requests',(SELECT count(*) FROM agent_runtime_request WHERE status='claimed'),
'queued_runs',(SELECT count(*) FROM agent_run WHERE status='pending' AND attempts=0),
'queued_chats',(SELECT count(*) FROM agent_chat_message WHERE role='assistant' AND status='pending' AND attempts=0))::text;"""
STOP_LOG = 'stopping —|quitting now —|descriptor reload drain|agent descriptors changed'


class LegacySystem(base.System):
    def inflight(self):
        value = json.loads(self.run('runuser', '-u', 'postgres', '--', 'psql', '-d', 'itsaplan',
                                   '-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', INFLIGHT_SQL))
        if set(value) != {'runs', 'chats', 'claimed_pending_chats', 'reflections', 'requests', 'queued_runs', 'queued_chats'} or any(
                type(count) is not int or count < 0 for count in value.values()):
            raise base.Refuse('Invalid in-flight metadata')
        return value

    def already_stopping(self, invocation):
        result = subprocess.run(
            ['journalctl', '--quiet', '--no-pager', '-o', 'cat',
             '_SYSTEMD_INVOCATION_ID=' + invocation, '--grep=' + STOP_LOG],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
        if result.returncode not in (0, 1) or result.stderr.strip():
            raise base.Refuse('Stop-history metadata unavailable; no signal')
        return bool(result.stdout.strip())

    def bundle_predates_process(self, bundle, ticks):
        boot = next(int(line.split()[1]) for line in Path('/proc/stat').read_text().splitlines()
                    if line.startswith('btime '))
        started = boot + int(ticks) / os.sysconf('SC_CLK_TCK')
        return bundle.stat().st_mtime <= started


class Bootstrap(base.Drain):
    def __init__(self, system, **kwargs):
        kwargs.setdefault('state_dir', Path('/var/lib/volition/deploy/legacy-runner-bootstrap'))
        kwargs.setdefault('dropin', Path('/run/systemd/system/' + base.UNIT + '.d/89-helena-legacy-bootstrap.conf'))
        super().__init__(system, **kwargs)
        self.plan_file = self.root / 'reviewed-plan.json'

    def read_plan(self):
        value = json.loads(base.regular(self.plan_file, self.uid, 0o600))
        if value.get('legacyCliHash') != LEGACY_CLI_SHA256 or value.get('version') != 1:
            raise base.Refuse('Unrecognized legacy bootstrap plan')
        return value

    def source(self):
        return self.system.run('git', '-c', 'safe.directory=' + str(self.live), '-C', str(self.live),
                               'rev-parse', 'HEAD')

    def no_inflight(self):
        counts = self.system.inflight()
        if any(counts[key] for key in ('runs', 'chats', 'claimed_pending_chats', 'reflections', 'requests')):
            raise base.Refuse('Claimed runs, runtime work or streaming chats remain; no deployment or signal')
        return counts

    def plan(self, target, old_bundle):
        if not re.fullmatch(r'[0-9a-f]{40}', target or '') or not re.fullmatch(r'[0-9a-f]{64}', old_bundle or ''):
            raise base.Refuse('Full tested target and independently reviewed old bundle SHA256 are required')
        if self.file.exists() or self.dropin.exists() or self.dropin.is_symlink():
            raise base.Refuse('Existing bootstrap state must be inspected, never overwritten')
        current = self.system.show()
        cli = self.live / 'packages/runner/src/cli.ts'
        if base.digest(cli.read_bytes()) != LEGACY_CLI_SHA256:
            raise base.Refuse('Legacy CLI source is not the exact reviewed implementation')
        if base.digest(base.regular(self.bundle, self.uid)) != old_bundle:
            raise base.Refuse('Old bundle does not match the independently supplied hash')
        if (current['ActiveState'] != 'active' or current['SubState'] != 'running'
                or current['Job'] not in ('', '0') or current['ControlPID'] != '0'
                or not re.fullmatch(r'[0-9a-f]{32}', current['InvocationID'])):
            raise base.Refuse('Legacy runner is not a stable running invocation')
        ticks = self.system.identity(current['MainPID'])
        if not self.system.bundle_predates_process(self.bundle, ticks):
            raise base.Refuse('Bundle changed after this process started; legacy identity is ambiguous')
        if self.system.already_stopping(current['InvocationID']):
            raise base.Refuse('Legacy invocation already received a stop/drain request')
        counts = self.no_inflight()
        value = dict(version=1, target=target, source=self.source(), bundleHash=old_bundle,
                     legacyCliHash=LEGACY_CLI_SHA256, pid=current['MainPID'], startTicks=ticks,
                     invocation=current['InvocationID'], unitHashes=self.unit_hashes(current), counts=counts)
        payload = (json.dumps(value, sort_keys=True) + '\n').encode()
        if self.plan_file.exists():
            if base.regular(self.plan_file, self.uid, 0o600) != payload:
                raise base.Refuse('An earlier reviewed plan differs; left unchanged')
        else:
            base.durable(self.plan_file, payload, self.uid)
        return value

    def read_capability(self, current):
        plan = self.read_plan()
        if (current['MainPID'] != plan['pid'] or current['InvocationID'] != plan['invocation']
                or self.system.identity(current['MainPID']) != plan['startTicks']
                or self.source() != plan['source']
                or base.digest(base.regular(self.bundle, self.uid)) != plan['bundleHash']
                or base.digest((self.live / 'packages/runner/src/cli.ts').read_bytes()) != LEGACY_CLI_SHA256
                or self.unit_hashes(current) != plan['unitHashes']
                or self.system.already_stopping(current['InvocationID'])):
            raise base.Refuse('Pinned legacy invocation/source changed or was already stopping; no signal')
        # This adapter is restricted to this separate, source-pinned one-shot operator.
        return dict(version=1, pid=int(plan['pid']), startTicks=plan['startTicks'], phase='running')

    def drain_legacy(self, seconds):
        plan = self.read_plan()
        if self.load() is None:
            self.no_inflight()
        super().drain(plan['target'], seconds, before=plan['source'])
        self.no_inflight()

    def release(self):
        plan = self.read_plan()
        self.load()
        if not self.state or self.state['phase'] not in ('drained', 'released'):
            raise base.Refuse('Legacy drain has not completed')
        current = self.system.show()
        if (not self.drained(current) or self.source() != plan['source']
                or self.unit_hashes(current) != plan['unitHashes']
                or base.digest(base.regular(self.bundle, self.uid)) != plan['bundleHash']):
            raise base.Refuse('Legacy process/cgroup is not empty or old source changed; no release')
        self.no_inflight()
        if self.state['phase'] == 'drained':
            self.own_override()
            self.save('released')
        if self.dropin.exists() or self.dropin.is_symlink():
            self.own_override()
            self.dropin.unlink()
            base.sync_dir(self.dropin.parent)
        self.system.run('systemctl', 'daemon-reload')
        return {'phase': 'released', 'target': plan['target'], 'runner': 'inactive',
                'next': 'Root may now deploy the exact tested capability release; this operator starts nothing'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('plan', 'drain', 'release', 'status'))
    parser.add_argument('--target')
    parser.add_argument('--old-bundle-sha256')
    parser.add_argument('--deadline-seconds', type=int, default=120)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise base.Refuse('Legacy bootstrap is Root-only')
    controller = Bootstrap(LegacySystem())
    base.private_dir(controller.root, 0)
    lock = os.open(controller.root / 'lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        base.regular(controller.root / 'lock', 0, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'plan':
            print(json.dumps(controller.plan(args.target, args.old_bundle_sha256), sort_keys=True))
        elif args.action == 'drain':
            if not 1 <= args.deadline_seconds <= 7200:
                raise base.Refuse('Operator deadline must be 1..7200 seconds')
            controller.drain_legacy(args.deadline_seconds)
            print('Legacy runner drained; verify metadata and release before the exact target deployment')
        elif args.action == 'release':
            print(json.dumps(controller.release(), sort_keys=True))
        else:
            state = controller.load()
            print(json.dumps({key: state[key] for key in ('phase', 'target', 'pid', 'invocation')} if state else {'phase': 'planned' if controller.plan_file.exists() else 'none'}))
    finally:
        os.close(lock)


if __name__ == '__main__':
    try:
        main()
    except (base.Refuse, OSError, ValueError, subprocess.TimeoutExpired) as error:
        raise SystemExit('legacy-runner-bootstrap: ' + str(error)) from None
