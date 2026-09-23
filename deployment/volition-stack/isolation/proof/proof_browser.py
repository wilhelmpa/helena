"""Browser proof (design §6.7): a project browser whose state was made by the runner user, as
today, gets a login cookie, is migrated to the browser user and started from the new unit
files; the login is still there, the processes run as the browser user, and an agent unit
reaches neither its CDP port nor its profile."""

from __future__ import annotations

import json
import os
import pwd
import sqlite3
import subprocess
import time

SLUG = 'alpha'
BASES = {'display': 250, 'cdp': 19250, 'vnc': 15950, 'noVnc': 16150}


def run_browser_proofs(report, sh, root: str, state: dict) -> None:
    source = state['source']
    browser_root = f'{root}/project-browser/projects'
    iso = f'{root}/isolation'
    env = {
        'PATH': '/usr/local/bin:/usr/bin:/bin',
        'PROJECT_BROWSER_ROOT': browser_root,
        'PROJECT_BROWSER_DISPLAY_BASE': str(BASES['display']),
        'PROJECT_BROWSER_CDP_PORT_BASE': str(BASES['cdp']),
        'PROJECT_BROWSER_VNC_PORT_BASE': str(BASES['vnc']),
        'PROJECT_BROWSER_NOVNC_PORT_BASE': str(BASES['noVnc']),
    }
    hermes = pwd.getpwnam('vpt-hermes')
    # Before the migration: the runner user makes the state, the way provisioning does today.
    os.makedirs(f'{root}/project-browser', exist_ok=True)
    os.chown(f'{root}/project-browser', hermes.pw_uid, hermes.pw_gid)
    os.chmod(f'{root}/project-browser', 0o750)
    script = f'{iso}/browser/project-browser-state.mjs'
    made = sh('/usr/sbin/runuser', '-u', 'vpt-hermes', '--', '/usr/local/bin/node', script, 'ensure', SLUG, '1',
              env=env, check=False)
    report.add('7', 'browser state made as the runner user', made.returncode == 0,
               (made.stdout or made.stderr).decode().strip()[-200:])
    if made.returncode != 0:
        return
    port = json.loads(made.stdout.decode().strip().splitlines()[-1])['state']['cdpPort']

    def start(user: str) -> None:
        for name in ('kasm', 'chromium'):
            unit_file = os.path.join(source, '..', 'native', 'systemd', f'volition-project-browser-{name}@.service')
            command = ['systemd-run', f'--unit=vpt-browser-{name}-{SLUG}', '--quiet', '--collect']
            exec_start = []
            with open(unit_file, encoding='utf-8') as handle:
                section = None
                for line in handle:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    if line.startswith('['):
                        section = line.strip('[]')
                        continue
                    if section != 'Service':
                        continue
                    line = (line.replace('%i', SLUG).replace('/var/lib/volition/project-browser/projects', browser_root)
                            .replace('User=volition-browser', f'User={user}')
                            .replace('/usr/local/libexec/volition-wait-for-x', '/usr/bin/true'))
                    key, _, value = line.partition('=')
                    if key == 'ExecStart':
                        exec_start = value.split()
                    elif key == 'ExecStartPre':
                        continue
                    elif key == 'Type':
                        command.append(f'--service-type={value}')
                    else:
                        command.append(f'--property={key}={value}')
            sh(*command, '--', *exec_start)
            time.sleep(2 if name == 'kasm' else 0)

    def stop() -> None:
        for name in ('chromium', 'kasm'):
            sh('systemctl', 'stop', f'vpt-browser-{name}-{SLUG}.service', check=False)
        time.sleep(1)

    def cdp(*args: str) -> dict:
        for _ in range(30):
            done = sh('/usr/local/bin/node', f'{iso}/cdp.mjs', str(port), *args, check=False)
            if done.returncode == 0:
                return json.loads(done.stdout.decode().strip().splitlines()[-1])
            time.sleep(1)
        return {'ok': False, 'error': (done.stderr or b'').decode()[-200:]}

    try:
        start('vpt-hermes')
        answer = cdp('set', 'vpt_login', 'proof-session-4242')
        report.add('7', 'login cookie set while the browser ran as the runner user', answer.get('ok') is True,
                   json.dumps(answer))
        # Chromium writes its cookie store every 30 seconds; the proof waits until the login
        # is on disk, where a real one would long have been.
        stored = 0
        database = f'{browser_root}/{SLUG}/profile/Default/Cookies'
        for _ in range(40):
            try:
                with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as connection:
                    stored = connection.execute("select count(*) from cookies where name = 'vpt_login'").fetchone()[0]
            except sqlite3.Error:
                stored = 0
            if stored:
                break
            time.sleep(2)
        report.add('7', 'the login is in the profile on disk', stored == 1, f'{stored} cookie row(s)')
    finally:
        stop()
    migrate = sh('/usr/bin/python3', '-I', f'{iso}/migrate.py', 'apply', '--config', f'{iso}/launcher.json',
                 '--browser-root', f'{root}/project-browser', '--browser-user', 'vpt-browser', check=False)
    report.add('7', 'migration hands the browser state to the browser user', migrate.returncode == 0,
               migrate.stdout.decode().strip().splitlines()[-1][:200] if migrate.stdout else migrate.stderr.decode()[-200:])
    try:
        start('vpt-browser')
        answer = cdp('get', 'vpt_login')
        report.add('7', 'the login is still there after the migration',
                   answer.get('value') == 'proof-session-4242', json.dumps(answer))
        users = []
        for name in ('kasm', 'chromium'):
            pid = sh('systemctl', 'show', '-p', 'MainPID', '--value', f'vpt-browser-{name}-{SLUG}.service').stdout.decode().strip()
            user = sh('ps', '-o', 'user=', '-p', pid, check=False).stdout.decode().strip()
            users.append(f'{name}={user}')
        report.add('7', 'Xvnc and Chromium run as the browser user', all(u.endswith('=vpt-browser') for u in users),
                   ', '.join(users))
        profile = f'{browser_root}/{SLUG}/profile'
        info = os.stat(profile)
        report.add('7', 'the profile is the browser user\'s, 0700',
                   pwd.getpwuid(info.st_uid).pw_name == 'vpt-browser' and oct(info.st_mode & 0o777) == '0o700',
                   f'{pwd.getpwuid(info.st_uid).pw_name} {oct(info.st_mode & 0o777)}')
        denied = sh('/usr/sbin/runuser', '-u', 'vpt-hermes', '--', 'ls', profile, check=False)
        report.add('7', 'the runner user cannot read the profile any more', denied.returncode != 0,
                   (denied.stderr or b'').decode().strip()[:120])
        agent = sh('/usr/sbin/runuser', '-u', 'vpt-hermes', '--', '/usr/bin/python3', '-I', f'{iso}/launch_client.py', 'run',
                   '--slug', 'alpha', '--profile', 'alpha', '--runtime', 'probe', '--cwd', f'{root}/workspaces/projects/alpha',
                   '--', f'tcp:127.0.0.1,{port}', f'read:{profile}', f'curl:http://127.0.0.1:{port}/json/version',
                   env={'VOLITION_LAUNCHER_SOCKET': '/run/vpt-launcher/launch.sock', 'PATH': '/usr/bin:/bin'}, check=False)
        results = json.loads(agent.stdout.decode().strip().splitlines()[-1]) if agent.stdout else {}
        report.add('7', 'an agent reaches neither the CDP port nor the profile',
                   bool(results) and not any(value['ok'] for value in results.values()), json.dumps(results)[:240])
    finally:
        stop()
