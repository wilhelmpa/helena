"""The token keeper's own logic, without Hermes (system Python; part of the full test).

test_token_keeper_hermes.py runs the same keeper against Hermes' real credential pool.
"""

from __future__ import annotations

import base64
import contextlib
import importlib.util
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Optional
from unittest import mock

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('helena_token_keeper_unit', HERE / 'helena_token_keeper.py')
KEEPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(KEEPER)


def jwt(**claims) -> str:
    def enc(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b'=').decode()

    return f"{enc({'alg': 'none'})}.{enc(claims)}.sig"


@dataclass
class Row:
    id: str
    access_token: str
    refresh_token: Optional[str]
    expires_at_ms: Optional[int]
    label: str = 'login'
    auth_type: str = 'oauth'
    last_status: Optional[str] = None
    last_error_message: Optional[str] = None
    last_error_code: Optional[int] = None


class FakePool:
    def __init__(self, hermes, provider):
        self.hermes, self.provider = hermes, provider

    def entries(self):
        return list(self.hermes.rows.get(self.provider, []))

    def reset_status(self, entry_id):
        self.hermes.reset.append(entry_id)


class FakeHermes:
    """Stands in for KEEPER.Hermes: rows per provider, a refresh that rotates or fails."""

    STATUS_DEAD = 'dead'
    STATUS_EXHAUSTED = 'exhausted'
    AUTH_TYPE_OAUTH = 'oauth'
    managed = KEEPER.MANAGED_PROVIDERS

    def __init__(self):
        self.rows: dict[str, list[Row]] = {}
        self.refreshed: list[str] = []
        self.fail: Optional[str] = None
        self.reset: list[str] = []
        self.store = {'version': 1}
        self.probe_status = 200
        self.probe_calls = []

    def add(self, provider, row):
        self.rows.setdefault(provider, []).append(row)
        return row

    def load_pool(self, provider):
        return FakePool(self, provider)

    def load_store(self, path):
        return {**self.store, 'credential_pool': {
            provider: [{'id': row.id, 'access_token': row.access_token, 'refresh_token': row.refresh_token}
                       for row in rows] for provider, rows in self.rows.items()}}

    @contextlib.contextmanager
    def store_lock(self):
        yield

    def providers(self, store, home):
        return sorted(self.rows)

    def expiry(self, provider, entry):
        return entry.expires_at_ms / 1000 if entry.expires_at_ms else None

    def probe(self, provider, access_token):
        self.probe_calls.append(provider)
        return self.probe_status

    def invalidate(self, provider, entry):
        rows = self.rows[provider]
        for i, row in enumerate(rows):
            if row.id == entry.id and (row.access_token, row.refresh_token) == (entry.access_token, entry.refresh_token):
                rows[i] = replace(row, last_status='dead', last_error_code=401,
                                  last_error_message=KEEPER.LOGIN_REJECTED)
                return True
        return False

    def refresh(self, pool, entry):
        self.refreshed.append(entry.id)
        rows = self.rows[pool.provider]
        index = next(i for i, row in enumerate(rows) if row.id == entry.id)
        if self.fail == 'dead':
            rows[index] = replace(entry, last_status='dead', last_error_message='HTTP 400 invalid_grant')
            return None
        if self.fail == 'transient':
            rows[index] = replace(entry, last_status='exhausted')
            return None
        access = jwt(exp=int(time.time()) + 8 * 3600) if entry.access_token.count('.') == 2 else entry.access_token + '+'
        new = replace(entry, access_token=access, refresh_token=(entry.refresh_token or '') + '+',
                      expires_at_ms=int((time.time() + 8 * 3600) * 1000), last_status='ok')
        # An alias row on the same chain follows, as Hermes' singleton sync does.
        for i, row in enumerate(rows):
            if row.refresh_token == entry.refresh_token:
                rows[i] = replace(new, id=row.id)
        return new


def ms(seconds_from_now: float) -> int:
    return int((time.time() + seconds_from_now) * 1000)


class KeeperLogic(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(dir=os.environ.get('TMPDIR')))
        self.hermes = FakeHermes()
        self.units = 0
        self.slept = 0

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def keeper(self, *extra, launcher: Optional[dict] = None):
        launcher_path = ''
        if launcher is not None:
            launcher_path = str(self.dir / 'launcher.json')
            Path(launcher_path).write_text(json.dumps(launcher))
        args = KEEPER.parse(['tick', '--hermes-home', str(self.dir / 'hermes'), '--state-dir', str(self.dir / 'keeper'),
                             '--launcher-config', launcher_path, '--quiet-wait', '30', '--quiet-poll', '15', *extra])

        def sleep(seconds):
            self.slept += seconds

        return KEEPER.Keeper(KEEPER.Settings(args), self.hermes, units=lambda: self.units, sleep=sleep)

    def test_thresholds_follow_the_longest_agent_unit(self):
        settings = self.keeper(launcher={'limits': {'runtimeMaxSecLimit': 7200}, 'unitPrefix': 'x-'}).settings
        self.assertEqual(settings.force_before, 7200 + 2 * 600 + 300)
        self.assertEqual(settings.prefer_before, 6 * 3600)
        self.assertEqual(settings.unit_prefix, 'x-')
        # A unit that may run longer than the preferred margin pushes it out.
        settings = self.keeper(launcher={'limits': {'runtimeMaxSecLimit': 8 * 3600}}).settings
        self.assertEqual(settings.prefer_before, settings.force_before + 3600)

    def test_due_only_for_managed_refreshable_live_rows_near_expiry(self):
        keeper = self.keeper()
        now = time.time()
        self.assertEqual(keeper.due('anthropic', Row('a', 'at', 'rt', ms(3 * 3600)), now), 'force')
        self.assertEqual(keeper.due('anthropic', Row('a', 'at', 'rt', ms(5 * 3600)), now), 'prefer')
        self.assertIsNone(keeper.due('anthropic', Row('a', 'at', 'rt', ms(7 * 3600)), now))
        self.assertIsNone(keeper.due('anthropic', Row('a', 'at', None, ms(60)), now))
        self.assertIsNone(keeper.due('anthropic', Row('a', 'at', 'rt', ms(60), last_status='dead'), now))
        self.assertIsNone(keeper.due('anthropic', Row('a', 'at', 'rt', ms(60), auth_type='api_key'), now))
        self.assertIsNone(keeper.due('nous', Row('a', 'at', 'rt', ms(60)), now))
        self.assertIsNone(keeper.due('anthropic', Row('a', 'at', 'rt', None), now))

    def test_a_login_is_refreshed_at_most_every_min_gap_while_it_works(self):
        keeper = self.keeper()
        now = time.time()
        keeper.state.entry('anthropic:a')['refreshedAt'] = now - 60
        self.assertIsNone(keeper.due('anthropic', Row('a', 'at', 'rt', ms(3600)), now))
        # An expired one is refreshed regardless.
        self.assertEqual(keeper.due('anthropic', Row('a', 'at', 'rt', ms(-60)), now), 'force')

    def test_failures_back_off(self):
        keeper = self.keeper()
        now = time.time()
        record = keeper.state.entry('anthropic:a')
        record.update(failures=3, attemptAt=now - 1200)
        self.assertIsNone(keeper.due('anthropic', Row('a', 'at', 'rt', ms(3600)), now))
        record['attemptAt'] = now - 2400
        self.assertEqual(keeper.due('anthropic', Row('a', 'at', 'rt', ms(3600)), now), 'force')

    def test_only_agent_runs_and_chats_count_as_agent_units(self):
        listing = (
            'volition-agent-launcher.service loaded active running Volition agent launcher\n'
            'volition-agent-plan.service loaded active running Volition Plan API for isolated agents\n'
            'volition-agent-verve--a0-t0-9ac493ee15ba.service loaded active running terminal\n'
            'volition-agent-browser-state-0a1b2c3d4e5f.service loaded active running browser state\n'
            'volition-agent-vol--a6-r24-518c7d7d0bdb.service loaded active running run\n'
            'volition-agent-priv--a4-c109-3a9cbd2cc6ef.service loaded activating start chat\n'
        )

        def runner(*args, **kwargs):
            return subprocess.CompletedProcess(args, 0, stdout=listing, stderr='')

        self.assertEqual(KEEPER.running_agent_units('volition-agent-', runner=runner), 2)
        quiet = 'volition-agent-launcher.service loaded active running x\nvolition-agent-plan.service loaded active running x\n'
        self.assertEqual(KEEPER.running_agent_units(
            'volition-agent-', runner=lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout=quiet, stderr='')), 0)

    def test_a_preferred_refresh_waits_for_no_agent_unit_a_forced_one_does_not(self):
        self.hermes.add('anthropic', Row('a', 'at', 'rt', ms(5 * 3600)))
        self.units = 1
        keeper = self.keeper()
        keeper.tick(refresh=True)
        self.assertEqual(self.hermes.refreshed, [])
        self.assertEqual(self.slept, 30)
        self.hermes.rows['anthropic'][0].expires_at_ms = ms(3 * 3600)
        self.keeper().tick(refresh=True)
        self.assertEqual(self.hermes.refreshed, ['a'])

    def test_renew_refreshes_a_provider_now_once(self):
        self.hermes.add('anthropic', Row('a', 'at', 'rt', ms(7 * 3600)))
        self.hermes.add('openai-codex', Row('c', 'at', 'rt-c', ms(7 * 3600)))
        self.keeper('--renew', 'anthropic').tick(refresh=True)
        self.assertEqual(self.hermes.refreshed, ['a'])

    def test_renew_refreshes_rows_sharing_one_chain_once(self):
        self.hermes.add('openai-codex', Row('singleton', 'at', 'rt', ms(9 * 86400)))
        self.hermes.add('openai-codex', Row('alias', 'at', 'rt', ms(9 * 86400)))
        self.keeper('--renew', 'openai-codex').tick(refresh=True)
        self.assertEqual(self.hermes.refreshed, ['singleton'])

    def test_rows_sharing_one_refresh_token_are_refreshed_once(self):
        self.hermes.add('openai-codex', Row('singleton', jwt(exp=int(time.time()) + 3600), 'rt', None))
        self.hermes.add('openai-codex', Row('alias', jwt(exp=int(time.time()) + 3600), 'rt', None))
        self.hermes.expiry = lambda provider, entry: KEEPER.jwt_expiry(entry.access_token)
        self.keeper().tick(refresh=True)
        self.assertEqual(self.hermes.refreshed, ['singleton'])

    def test_a_dead_login_names_the_owners_command_and_is_not_retried(self):
        self.hermes.add('anthropic', Row('a', 'at', 'rt', ms(-60), label='anthropic-oauth-1'))
        self.hermes.fail = 'dead'
        status = self.keeper('--runner-user', 'runner', '--hermes-bin', '/opt/hermes/bin/hermes').tick(refresh=True)
        login = status['logins'][0]
        self.assertEqual(login['state'], 'invalid')
        self.assertEqual(login['command'], (
            f"sudo -u runner env HOME={self.dir / 'hermes'} HERMES_HOME={self.dir / 'hermes'} "
            '/opt/hermes/bin/hermes auth add anthropic --type oauth && sudo systemctl start helena-token-keeper.service'))
        self.keeper().tick(refresh=True)
        self.assertEqual(self.hermes.refreshed, ['a'])

    def test_a_dead_login_signed_in_again_beside_it_is_no_longer_reported(self):
        self.hermes.add('anthropic', Row('a', 'at', 'rt', ms(-60), last_status='dead'))
        self.hermes.add('anthropic', Row('b', 'at2', 'rt2', ms(8 * 3600)))
        status = self.keeper().tick(refresh=False)
        self.assertEqual([(login['id'], login['state']) for login in status['logins']], [('b', 'ok')])

    def test_a_failed_early_refresh_lifts_the_bench_hermes_puts_on_a_working_login(self):
        self.hermes.add('anthropic', Row('a', 'at', 'rt', ms(3600)))
        self.hermes.fail = 'transient'
        status = self.keeper().tick(refresh=True)
        self.assertEqual(self.hermes.reset, ['a'])
        self.assertEqual(status['logins'][0]['state'], 'error')

    def test_revoked_unexpired_login_is_persistently_invalid_without_spending_refresh_token(self):
        self.hermes.add('openai-codex', Row('c', 'access', 'refresh', ms(9 * 86400)))
        self.hermes.probe_status = 401
        status = self.keeper().tick(refresh=True)
        self.assertEqual(self.hermes.refreshed, [])
        self.assertEqual(self.hermes.rows['openai-codex'][0].last_status, 'dead')
        self.assertEqual(status['logins'][0]['state'], 'invalid')
        self.assertEqual(status['logins'][0]['error'], KEEPER.LOGIN_REJECTED)
        self.assertIn('auth add openai-codex', status['logins'][0]['command'])
        self.keeper().tick(refresh=True)
        self.assertEqual(self.hermes.probe_calls, ['openai-codex'])

    def test_temporary_probe_failures_never_invalidate_or_refresh_a_working_login(self):
        for code in (429, 500, 503, 403, 302, None):
            with self.subTest(code=code):
                self.hermes.rows = {'anthropic': [Row('a', 'access', 'refresh', ms(7 * 3600))]}
                self.hermes.probe_status = code
                status = self.keeper().tick(refresh=True)
                self.assertEqual(status['logins'][0]['state'], 'error')
                self.assertIsNone(status['logins'][0]['command'])
                self.assertNotEqual(self.hermes.rows['anthropic'][0].last_status, 'dead')
                self.assertEqual(self.hermes.refreshed, [])
        self.hermes.probe_status = 200
        self.assertEqual(self.keeper().tick(refresh=True)['logins'][0]['state'], 'ok')

    def test_a_new_login_clears_a_previous_rejection_and_late_401_keeps_a_rotated_token(self):
        old = Row('a', 'old-access', 'old-refresh', ms(7 * 3600))
        self.hermes.add('anthropic', old)
        self.hermes.probe_status = 401
        self.keeper().tick(refresh=True)
        self.hermes.rows['anthropic'] = [replace(old, access_token='new-access', refresh_token='new-refresh')]
        self.hermes.probe_status = 200
        self.assertEqual(self.keeper().tick(refresh=True)['logins'][0]['state'], 'ok')

        def late_rejection(provider, token):
            self.hermes.rows[provider] = [replace(old, access_token='newer-access')]
            return 401

        self.hermes.probe = late_rejection
        self.assertEqual(self.keeper().tick(refresh=True)['logins'][0]['state'], 'ok')
        self.assertNotEqual(self.hermes.rows['anthropic'][0].last_status, 'dead')

    def test_separate_codex_cli_rejection_is_visible_and_new_login_recovers(self):
        folder = self.dir / 'hermes' / '.codex'
        folder.mkdir(parents=True)
        file = folder / 'auth.json'
        file.write_text(json.dumps({'tokens': {'access_token': jwt(exp=time.time() + 86400), 'refresh_token': 'r'}}))
        self.hermes.probe_status = 401
        login = self.keeper().tick(refresh=True)['logins'][0]
        self.assertEqual((login['store'], login['state']), ('codex-cli', 'invalid'))
        file.write_text(json.dumps({'tokens': {'access_token': jwt(exp=time.time() + 172800), 'refresh_token': 'r2'}}))
        self.hermes.probe_status = 200
        self.assertEqual(self.keeper().tick(refresh=True)['logins'][0]['state'], 'ok')

    def test_provider_messages_do_not_reach_status_private_state_or_logs(self):
        self.hermes.add('anthropic', Row('a', 'access', 'refresh', ms(3600)))
        secret = 'tiny-secret'

        def refused(pool, entry):
            KEEPER.logging.getLogger('hermes_cli.auth_codex').warning('response body: %s', secret)
            raise ValueError(secret)

        self.hermes.refresh = refused
        with self.assertLogs(KEEPER.log, level='WARNING') as logs:
            status = self.keeper().tick(refresh=True)
        self.assertNotIn(secret, json.dumps(status))
        self.assertNotIn(secret, '\n'.join(logs.output))
        self.assertNotIn(secret, (self.dir / 'keeper' / 'state' / 'state.json').read_text())

    def test_views_and_status_hold_no_refresh_token(self):
        self.hermes.add('anthropic', Row('a', 'sk-ant-oat01-SECRETACCESS', 'SECRET-REFRESH-TOKEN', ms(7 * 3600)))
        codex = self.dir / 'hermes' / '.codex'
        codex.mkdir(parents=True)
        (codex / 'auth.json').write_text(json.dumps({'tokens': {'access_token': jwt(exp=int(time.time()) + 999),
                                                                'refresh_token': 'SECRET-CLI-REFRESH'}}))
        status = self.keeper().tick(refresh=True)
        view = (self.dir / 'keeper' / 'view' / 'hermes' / 'auth.json').read_text()
        self.assertNotIn('SECRET-REFRESH', view)
        self.assertIn('SECRETACCESS', view)
        self.assertNotIn('SECRET-CLI-REFRESH', (self.dir / 'keeper' / 'view' / 'codex' / 'auth.json').read_text())
        text = (self.dir / 'keeper' / 'status' / 'hermes.json').read_text()
        self.assertNotIn('SECRET', text)
        self.assertEqual(json.loads(text), status)
        self.assertEqual(stat.S_IMODE((self.dir / 'keeper' / 'state' / 'state.json').stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.dir / 'keeper' / 'status' / 'hermes.json').stat().st_mode), 0o640)

    def test_a_codex_cli_login_that_disappears_leaves_no_view(self):
        codex = self.dir / 'hermes' / '.codex'
        codex.mkdir(parents=True)
        (codex / 'auth.json').write_text(json.dumps({'tokens': {'access_token': 'x', 'refresh_token': 'y'}}))
        self.keeper().tick(refresh=False)
        self.assertTrue((self.dir / 'keeper' / 'view' / 'codex' / 'auth.json').exists())
        (codex / 'auth.json').unlink()
        self.keeper().tick(refresh=False)
        self.assertFalse((self.dir / 'keeper' / 'view' / 'codex' / 'auth.json').exists())
        self.assertTrue((self.dir / 'keeper' / 'view' / 'codex').is_dir())


class Helpers(unittest.TestCase):
    def test_http_probe_uses_only_status_no_body_and_never_follows_redirects(self):
        class Response:
            status_code = 401

            @property
            def text(self):
                raise AssertionError('response body must not be read')

        client = mock.MagicMock()
        client.stream.return_value.__enter__.return_value = Response()
        module = mock.MagicMock()
        module.Client.return_value.__enter__.return_value = client
        with mock.patch.dict(sys.modules, {'httpx': module}):
            self.assertEqual(KEEPER.Hermes.probe(None, 'anthropic', 'fake-short-token'), 401)
        module.Client.assert_called_once_with(timeout=10.0, follow_redirects=False)
        args, kwargs = client.stream.call_args
        self.assertEqual(args, ('GET', 'https://api.anthropic.com/api/oauth/usage'))
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer fake-short-token')

    def test_http_probe_drops_network_exception_text(self):
        module = mock.MagicMock()
        module.Client.side_effect = OSError('body with a tiny-secret')
        with mock.patch.dict(sys.modules, {'httpx': module}):
            self.assertIsNone(KEEPER.Hermes.probe(None, 'anthropic', 'fake-token'))

    def test_strip_refresh_tokens_everywhere(self):
        store = {'providers': {'x': {'tokens': {'access_token': 'a', 'refresh_token': 'r'}}},
                 'credential_pool': {'y': [{'access_token': 'a', 'refresh_token': 'r', 'refreshToken': 'r'}]}}
        self.assertEqual(KEEPER.strip_refresh_tokens(store), {
            'providers': {'x': {'tokens': {'access_token': 'a'}}}, 'credential_pool': {'y': [{'access_token': 'a'}]}})

    def test_redact_cuts_anything_token_like(self):
        text = KEEPER.redact('HTTP 400 invalid_grant for sk-ant-oat01-abcdefghijkl and eyJhbGciOiJub25lIn0.eyJ4IjoxfQ.sig')
        self.assertEqual(text, 'HTTP 400 invalid_grant for … and …')
        self.assertIsNone(KEEPER.redact(None))

    def test_jwt_expiry(self):
        self.assertEqual(KEEPER.jwt_expiry(jwt(exp=1234)), 1234.0)
        self.assertIsNone(KEEPER.jwt_expiry('opaque'))

    def test_atomic_write_reports_a_change_and_sets_the_mode(self):
        folder = Path(tempfile.mkdtemp(dir=os.environ.get('TMPDIR')))
        try:
            path = folder / 'a' / 'b.json'
            self.assertTrue(KEEPER.atomic_write(path, b'{}', 0o640))
            self.assertFalse(KEEPER.atomic_write(path, b'{}', 0o640))
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o640)
            self.assertEqual(sorted(p.name for p in path.parent.iterdir()), ['b.json'])
        finally:
            shutil.rmtree(folder)

    def test_status_command_prints_the_last_status(self):
        folder = Path(tempfile.mkdtemp(dir=os.environ.get('TMPDIR')))
        try:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(KEEPER.main(['status', '--state-dir', str(folder), '--launcher-config', '']), 0)
            self.assertEqual(json.loads(out.getvalue())['logins'], [])
        finally:
            shutil.rmtree(folder)


@unittest.skipUnless(sys.platform.startswith('linux') and shutil.which('bash'), 'install.sh runs on Linux')
class InstallScript(unittest.TestCase):
    """install.sh against a temporary tree, with systemctl stubbed."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(dir=os.environ.get('TMPDIR'))).resolve()
        stubs = self.dir / 'bin'
        stubs.mkdir()
        self.log = self.dir / 'calls.log'
        for tool in ('systemctl', 'groupadd', 'setfacl'):
            (stubs / tool).write_text(f'#!/bin/sh\necho "{tool} $*" >> {self.log}\nexit 0\n')
            (stubs / tool).chmod(0o755)
        self.env = {
            'PATH': f'{stubs}:/usr/bin:/bin', 'TOKEN_KEEPER_TEST': '1', 'TOKEN_KEEPER_LIB': str(self.dir / 'lib'),
            'TOKEN_KEEPER_UNITS': str(self.dir / 'units'), 'TOKEN_KEEPER_STATE': str(self.dir / 'state'),
            'TOKEN_KEEPER_HERMES_HOME': str(self.dir / 'hermes'),
            'TOKEN_KEEPER_LAUNCHER': str(self.dir / 'isolation' / 'launcher.json'),
        }

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def script(self, *args):
        return subprocess.run(['bash', str(HERE / 'install.sh'), *args], env=self.env, capture_output=True, text=True)

    def test_install_is_idempotent_and_a_dry_run_changes_nothing(self):
        dry = self.script('install', '--dry-run')
        self.assertEqual(dry.returncode, 0, dry.stderr)
        self.assertFalse((self.dir / 'lib').exists())
        done = self.script('install')
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertTrue((self.dir / 'lib' / 'helena_token_keeper.py').is_file())
        for name in ('helena-token-keeper.service', 'helena-token-keeper.timer',
                     'volition-hermes-runner.service.d/helena-token-keeper.conf',
                     'volition-plan-api.service.d/helena-token-keeper.conf'):
            self.assertTrue((self.dir / 'units' / name).is_file(), name)
        for name in ('status', 'state', 'view/hermes', 'view/codex'):
            self.assertTrue((self.dir / 'state' / name).is_dir(), name)
        calls = self.log.read_text()
        self.assertIn('systemctl enable --now helena-token-keeper.timer', calls)
        self.assertIn('systemctl start helena-token-keeper.service', calls)
        again = self.script('install', '--dry-run')
        self.assertNotIn('would install', again.stdout)
        self.assertIn('does not bind the views', again.stdout)

    def test_sync_installs_only_where_isolation_binds_the_views(self):
        nothing = self.script('sync')
        self.assertEqual(nothing.returncode, 0, nothing.stderr)
        self.assertFalse((self.dir / 'units').exists())
        (self.dir / 'isolation').mkdir()
        (self.dir / 'isolation' / 'launcher.json').write_text(json.dumps(
            {'credentialBinds': [{'source': f"{self.dir / 'state'}/view/codex"}]}))
        (self.dir / 'hermes').mkdir()
        (self.dir / 'hermes' / 'auth.json').write_text('{}')
        done = self.script('sync')
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertTrue((self.dir / 'units' / 'helena-token-keeper.timer').is_file())


if __name__ == '__main__':
    unittest.main()
