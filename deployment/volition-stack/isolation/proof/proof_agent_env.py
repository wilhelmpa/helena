"""Proofs of the environment variables Helena delivers to an agent (docs/helena-decisions/
agent-env.md) and of the clone job under isolation, run by harness.py as root (`prove --only E`).

- A delivered variable reaches the agent's command, travels on the launcher's stdin header and
  nowhere else: not in the unit's properties (D-Bus, readable by every local user), not on any
  command line, not readable in /proc by another project's user or an unrelated one.
- The clone job runs through the profile helper as the project's own user: the repository lands
  in the project's workspace owned by that user, another project's workspace stays out of reach.
- ssh goes through the egress proxy to GitHub's SSH on port 443 and checks GitHub's pinned host
  key (a refused key, not a host key failure, is the proof that it arrived).
"""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import time

TEST = 'E'


def _helper(client, root: str, slug: str, operation: dict, timeout: float = 300) -> dict:
    """One operation of the runner's profile helper, as the launcher runs it for the runner."""
    workspace = f'{root}/workspaces/projects/{slug}'
    done = client(['run', '--slug', slug, '--runtime', 'profile-helper', '--profile', slug,
                   '--cwd', workspace, '--kind', 'helper'],
                  stdin=json.dumps(operation).encode(), check=False, timeout=timeout)
    lines = done.stdout.decode(errors='replace').strip().splitlines()
    try:
        return json.loads(lines[-1])
    except (ValueError, IndexError):
        return {'ok': False, 'error': f'rc={done.returncode} {done.stderr.decode(errors="replace")[-300:]}'}


def _unit_of(sh, prefix: str, deadline: float) -> str | None:
    while time.time() < deadline:
        listing = sh('systemctl', 'list-units', '--plain', '--no-legend', f'{prefix}*', check=False)
        units = [line.split()[0] for line in listing.stdout.decode().splitlines() if line.split()]
        if units:
            return units[0]
        time.sleep(0.2)
    return None


def run_env_proofs(report, probe, client, sh, root: str, iso: str) -> None:
    token = f'cf-proof-{secrets.token_hex(16)}'
    # 1. The command has it, under its name.
    results = probe('alpha', 'alpha', ['exec:printenv,CLOUDFLARE_API_TOKEN'],
                    env={'CLOUDFLARE_API_TOKEN': token})
    value = results.get('exec:printenv,CLOUDFLARE_API_TOKEN', {})
    report.add(TEST, 'the command reads the delivered variable',
               value.get('ok') is True and token in value.get('detail', ''),
               (value.get('detail') or json.dumps(results))[:120].replace(token, '<token>'))

    # 2. While a command runs with it: nowhere a local user or another project could read it.
    workspace = f'{root}/workspaces/projects/alpha'
    running = subprocess.Popen(
        ['/usr/sbin/runuser', '-u', 'vpt-hermes', '--', '/usr/bin/python3', '-I', f'{iso}/launch_client.py',
         'run', '--slug', 'alpha', '--runtime', 'probe', '--profile', 'alpha', '--cwd', workspace,
         '--env', f'CLOUDFLARE_API_TOKEN={token}', '--', 'exec:sleep,6'],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={'PATH': '/usr/bin:/bin', 'VOLITION_LAUNCHER_SOCKET': '/run/vpt-launcher/launch.sock'})
    try:
        unit = _unit_of(sh, 'vpt-agent-alpha', time.time() + 15)
        report.add(TEST, 'the command runs in a unit of its own', unit is not None, unit or 'no unit')
        if unit:
            shown = sh('/usr/sbin/runuser', '-u', 'vpt-other', '--', 'systemctl', 'show', unit,
                       check=False).stdout.decode(errors='replace')
            report.add(TEST, 'not in the unit properties (D-Bus)', token not in shown,
                       'Environment= holds no delivered value' if token not in shown else 'value visible')
            main_pid = sh('systemctl', 'show', '-p', 'MainPID', '--value', unit, check=False).stdout.decode().strip()
            pids = sh('systemctl', 'show', '-p', 'ControlGroup', '--value', unit, check=False).stdout.decode().strip()
            cgroup = f'/sys/fs/cgroup{pids}/cgroup.procs' if pids else ''
            members = []
            if cgroup and os.path.exists(cgroup):
                with open(cgroup, encoding='ascii') as handle:
                    members = [line.strip() for line in handle if line.strip()]
            members = members or ([main_pid] if main_pid and main_pid != '0' else [])
            leaked_cmdline = False
            for pid in members:
                done = sh('/usr/sbin/runuser', '-u', 'vpt-other', '--', 'cat', f'/proc/{pid}/cmdline', check=False)
                leaked_cmdline = leaked_cmdline or token.encode() in (done.stdout or b'')
            report.add(TEST, 'not on any command line', not leaked_cmdline, f'{len(members)} processes read')
            for user in ('vpt-beta', 'vpt-other'):
                readable = False
                for pid in members:
                    done = sh('/usr/sbin/runuser', '-u', user, '--', 'cat', f'/proc/{pid}/environ', check=False)
                    readable = readable or token.encode() in (done.stdout or b'')
                report.add(TEST, f'{user} cannot read the environment', not readable,
                           f'{len(members)} processes tried')
    finally:
        try:
            running.wait(timeout=30)
        except subprocess.TimeoutExpired:
            running.kill()


def run_clone_proofs(report, probe, client, sh, root: str) -> None:
    alpha = f'{root}/workspaces/projects/alpha'
    beta = f'{root}/workspaces/projects/beta'
    source = f'{alpha}/.proof-source.git'
    # The repository to clone, inside the project's own workspace (file://: no network needed).
    sh('/usr/sbin/runuser', '-u', 'vpt-alpha', '--', 'git', 'init', '-q', '--bare', source, check=False)
    job = {'op': 'git_clone', 'url': f'file://{source}', 'folder': 'dev', 'name': 'proof-repo',
           'slug': 'alpha', 'workspace': alpha}
    profile = f'{root}/hermes/profiles/alpha'
    answer = _helper(client, root, 'alpha', {'op': 'workspace-job', 'job': job, 'base': alpha,
                                              'dir': f'{profile}/helena-ssh'})
    outcome = answer.get('result') or {}
    report.add(TEST, 'the clone job runs as the project user', answer.get('ok') is True and
               outcome.get('status') == 'success', json.dumps(answer)[:200])
    target = f'{alpha}/dev/proof-repo'
    try:
        info = os.stat(f'{target}/.git')
        owner = info.st_uid
        expected = int(sh('id', '-u', 'vpt-alpha').stdout.decode().strip())
        report.add(TEST, 'the clone belongs to the project user', owner == expected,
                   f'uid {owner}, vpt-alpha is {expected}')
    except OSError as error:
        report.add(TEST, 'the clone belongs to the project user', False, str(error))

    # A job naming another project's workspace cannot write there from this project's unit.
    foreign = {**job, 'slug': 'beta', 'workspace': beta, 'name': 'stolen'}
    answer = _helper(client, root, 'alpha', {'op': 'workspace-job', 'job': foreign, 'base': beta,
                                              'dir': f'{profile}/helena-ssh'})
    outcome = answer.get('result') or {}
    wrote = os.path.exists(f'{beta}/dev/stolen')
    report.add(TEST, "another project's workspace stays out of reach",
               not wrote and (answer.get('ok') is False or outcome.get('status') == 'failed'),
               json.dumps(answer)[:200])

    # ssh to GitHub through the egress proxy, with the pinned host key and a key GitHub does not
    # know: "Permission denied (publickey)" proves the connection arrived and the host key held.
    key = f'{root}/proof/throwaway-ed25519'
    if not os.path.exists(key):
        sh('ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'helena-proof', '-f', key)
    with open(key, encoding='ascii') as handle:
        private = handle.read()
    written = _helper(client, root, 'alpha', {'op': 'ssh-keys', 'dir': f'{profile}/helena-ssh',
                                               'keys': [{'id': 1, 'label': 'proof', 'updatedAt': 'x',
                                                         'privateKey': private}]})
    command = (written.get('result') or {}).get('GIT_SSH_COMMAND', '')
    report.add(TEST, 'ssh keys and pinned host keys written as the project user',
               written.get('ok') is True and 'GlobalKnownHostsFile' in command, command[:160])
    if command:
        # No commas in it: the probe's exec check splits its arguments on them.
        script = f'{command} -T git@github.com 2>&1; true'
        results = probe('alpha', 'alpha', [f'exec:/bin/sh,-c,{script}'])
        value = next(iter(results.values()), {})
        detail = value.get('detail', json.dumps(results))
        report.add(TEST, 'ssh reaches GitHub through the egress with the pinned key',
                   'Permission denied (publickey)' in detail and 'Host key verification failed' not in detail,
                   detail[-200:])
