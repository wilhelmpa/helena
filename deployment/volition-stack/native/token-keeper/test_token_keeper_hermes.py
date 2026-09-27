"""The token keeper against Hermes' own credential pool (fake tokens, no network).

Needs Hermes importable (its interpreter, PYTHONPATH=<hermes source>); skipped otherwise, so the
system Python of the full test only runs test_helena_token_keeper.py. On Kingston:

    PYTHONPATH=<hermes source> <hermes venv>/bin/python -m unittest test_token_keeper_hermes -v

Each test builds a Hermes root in a temporary folder, patches the provider token endpoints
(`refresh_anthropic_oauth_pure`, `refresh_codex_oauth_pure`) and runs the keeper as the timer
would. The last group plays an isolated agent: Hermes in a profile whose root auth.json is the
keeper's view in a read-only folder.
"""

from __future__ import annotations

import base64
import importlib.util
import io
import json
import os
import shutil
import stat
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

try:
    import agent.anthropic_credentials as anthropic_credentials
    import agent.credential_pool as credential_pool
    import hermes_cli.auth as hermes_auth
    HERMES = True
except Exception:  # noqa: BLE001 - no Hermes here
    HERMES = False

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('helena_token_keeper', HERE / 'helena_token_keeper.py')
KEEPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(KEEPER)


def jwt(**claims) -> str:
    def enc(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b'=').decode()

    return f"{enc({'alg': 'none'})}.{enc(claims)}.signature"


def codex_token(expires_in: float, n: int = 0) -> str:
    return jwt(exp=int(time.time() + expires_in), n=n, sub='user-1',
               **{'https://api.openai.com/auth': {'chatgpt_account_id': 'account-1'}})


class Root:
    """A Hermes root with a profile, as on Kingston (root/profiles/<name>)."""

    def __init__(self):
        self.base = Path(tempfile.mkdtemp(dir=os.environ.get('TMPDIR'))).resolve()
        self.home = self.base / 'hermes'
        self.profile = self.home / 'profiles' / 'alpha'
        self.profile.mkdir(parents=True)
        for home in (self.home, self.profile):
            (home / 'config.yaml').write_text('model:\n  provider: openai-codex\n  default: gpt-5.6-luna\n')
        self.state = self.base / 'keeper'
        self.store = {'version': 1, 'providers': {}, 'credential_pool': {}}

    def anthropic(self, expires_in: float, *, entry_id='abc123', refresh='rt-anthropic-0', access='sk-ant-oat01-access-0',
                  status=None):
        row = {
            'id': entry_id, 'label': 'anthropic-oauth-1', 'auth_type': 'oauth', 'priority': 0,
            'source': 'manual:hermes_pkce', 'access_token': access, 'refresh_token': refresh,
            'expires_at_ms': int((time.time() + expires_in) * 1000), 'base_url': 'https://api.anthropic.com',
        }
        if status:
            row['last_status'] = status
        self.store['credential_pool'].setdefault('anthropic', []).append(row)
        return self

    def codex(self, expires_in: float, *, refresh='rt-codex-0', n=0):
        access = codex_token(expires_in, n)
        self.store['active_provider'] = 'openai-codex'
        self.store['providers']['openai-codex'] = {
            'tokens': {'access_token': access, 'refresh_token': refresh, 'id_token': jwt(email='owner@example.com')},
            'last_refresh': '2026-09-20T10:00:00Z', 'auth_mode': 'chatgpt',
        }
        return self

    def codex_cli(self, *, access, refresh):
        folder = self.home / '.codex'
        folder.mkdir(exist_ok=True)
        (folder / 'auth.json').write_text(json.dumps({
            'OPENAI_API_KEY': None,
            'tokens': {'id_token': 'cli-id-token', 'access_token': access, 'refresh_token': refresh, 'account_id': 'account-1'},
            'last_refresh': '2026-09-20T10:00:00Z',
        }))
        os.chmod(folder / 'auth.json', 0o600)

    def write(self):
        path = self.home / 'auth.json'
        path.write_text(json.dumps(self.store))
        os.chmod(path, 0o600)
        return self

    def read(self) -> dict:
        return json.loads((self.home / 'auth.json').read_text())

    def cleanup(self):
        for path in (self.home, self.base):
            if path.exists():
                os.chmod(path, 0o755)
        shutil.rmtree(self.base, ignore_errors=True)


@unittest.skipUnless(HERMES, 'Hermes is not importable here')
class KeeperWithHermes(unittest.TestCase):
    def setUp(self):
        self.root = Root()
        self.env = mock.patch.dict(os.environ, {'HERMES_HOME': str(self.root.home), 'HOME': str(self.root.home)})
        self.env.start()
        self.anthropic_calls = []
        self.codex_calls = []
        self.anthropic_answer = None
        self.codex_answer = None
        self.running_units = 0

        def fake_anthropic(refresh_token, *, use_json=False):
            self.anthropic_calls.append(refresh_token)
            if isinstance(self.anthropic_answer, BaseException):
                raise self.anthropic_answer
            n = len(self.anthropic_calls)
            return {'access_token': f'sk-ant-oat01-access-{n}', 'refresh_token': f'rt-anthropic-{n}',
                    'expires_at_ms': int((time.time() + 8 * 3600) * 1000)}

        def fake_codex(access_token, refresh_token, *, timeout_seconds=20.0):
            self.codex_calls.append(refresh_token)
            if isinstance(self.codex_answer, BaseException):
                raise self.codex_answer
            n = len(self.codex_calls)
            return {'access_token': codex_token(10 * 86400, 100 + n), 'refresh_token': f'rt-codex-{n}',
                    'last_refresh': '2026-09-24T18:00:00Z'}

        self.patches = [
            mock.patch.object(KEEPER.Hermes, 'probe', return_value=200),
            mock.patch.object(anthropic_credentials, 'refresh_anthropic_oauth_pure', fake_anthropic),
            mock.patch.object(hermes_auth, 'refresh_codex_oauth_pure', fake_codex, create=True),
        ]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        self.env.stop()
        self.root.cleanup()

    def keeper(self, *extra):
        args = KEEPER.parse(['tick', '--hermes-home', str(self.root.home), '--state-dir', str(self.root.state),
                             '--launcher-config', '', '--quiet-wait', '0', *extra])
        settings = KEEPER.Settings(args)
        return KEEPER.Keeper(settings, KEEPER.Hermes(), units=lambda: self.running_units, sleep=lambda _: None)

    def tick(self, *extra):
        return self.keeper(*extra).tick(refresh=True)

    def view(self) -> dict:
        return json.loads((self.root.state / 'view' / 'hermes' / 'auth.json').read_text())

    def login(self, status, provider, store='hermes'):
        return next(login for login in status['logins'] if login['provider'] == provider and login['store'] == store)

    # ── refreshing ──

    def test_refreshes_a_claude_login_before_it_expires_and_writes_it_back_to_the_root(self):
        self.root.anthropic(2 * 3600).write()
        status = self.tick()
        self.assertEqual(self.anthropic_calls, ['rt-anthropic-0'])
        row = self.root.read()['credential_pool']['anthropic'][0]
        self.assertEqual((row['access_token'], row['refresh_token']), ('sk-ant-oat01-access-1', 'rt-anthropic-1'))
        login = self.login(status, 'anthropic')
        self.assertEqual((login['state'], login['managed']), ('ok', True))
        self.assertIsNotNone(login['refreshedAt'])

    def test_leaves_a_login_alone_that_is_not_due(self):
        self.root.anthropic(7 * 3600).write()
        status = self.tick()
        self.assertEqual(self.anthropic_calls, [])
        self.assertEqual(self.login(status, 'anthropic')['state'], 'ok')

    def test_401_invalidates_the_real_pool_and_agent_view_without_refresh(self):
        self.root.anthropic(7 * 3600).codex(9 * 86400).write()
        with mock.patch.object(KEEPER.Hermes, 'probe', return_value=401) as probe:
            status = self.tick()
            self.assertEqual(probe.call_count, 2)
            self.tick()
            self.assertEqual(probe.call_count, 2)
        self.assertEqual(self.anthropic_calls + self.codex_calls, [])
        for provider in ('anthropic', 'openai-codex'):
            login = self.login(status, provider)
            self.assertEqual(login['state'], 'invalid')
            self.assertEqual(login['error'], KEEPER.LOGIN_REJECTED)
            self.assertIn('auth add ' + provider, login['command'])
            self.assertTrue(all(row['last_status'] == 'dead'
                                for row in self.view()['credential_pool'][provider]))

    def test_late_401_does_not_invalidate_a_new_pair_in_the_real_pool(self):
        self.root.anthropic(7 * 3600).write()
        hermes = KEEPER.Hermes()
        old = hermes.load_pool('anthropic').entries()[0]
        self.root.store['credential_pool']['anthropic'][0].update(
            access_token='new-access', refresh_token='new-refresh')
        self.root.write()
        self.assertFalse(hermes.invalidate('anthropic', old))
        self.assertNotEqual(self.root.read()['credential_pool']['anthropic'][0].get('last_status'), 'dead')

    def test_new_pair_recovers_after_a_real_pool_rejection(self):
        self.root.anthropic(7 * 3600).write()
        with mock.patch.object(KEEPER.Hermes, 'probe', return_value=401):
            self.assertEqual(self.login(self.tick(), 'anthropic')['state'], 'invalid')
        self.root.store['credential_pool']['anthropic'][0].update(
            access_token='new-access', refresh_token='new-refresh')
        self.root.write()
        self.assertEqual(self.login(self.tick(), 'anthropic')['state'], 'ok')

    def test_a_due_login_waits_for_a_moment_without_agent_units_unless_it_must_not(self):
        self.root.anthropic(5 * 3600).write()
        self.running_units = 2
        status = self.tick()
        self.assertEqual(self.anthropic_calls, [])
        self.assertEqual(self.login(status, 'anthropic')['state'], 'expiring')
        # Within force_before (the longest unit and two ticks), it no longer waits.
        self.root.store['credential_pool']['anthropic'][0]['expires_at_ms'] = int((time.time() + 3 * 3600) * 1000)
        self.root.write()
        self.tick()
        self.assertEqual(self.anthropic_calls, ['rt-anthropic-0'])

    def test_a_dead_grant_is_marked_in_the_root_and_names_the_owners_command(self):
        self.root.anthropic(-60).write()
        self.anthropic_answer = anthropic_credentials.AnthropicOAuthError(
            400, 'invalid_grant', 'Refresh token not found or invalid', what='refresh')
        status = self.tick()
        row = self.root.read()['credential_pool']['anthropic'][0]
        self.assertEqual(row['last_status'], 'dead')
        login = self.login(status, 'anthropic')
        self.assertEqual(login['state'], 'invalid')
        self.assertEqual(login['error'], KEEPER.REFRESH_REJECTED)
        self.assertIn('auth add anthropic', login['command'])
        self.assertIn(f"HERMES_HOME={self.root.home}", login['command'])
        self.assertIn('systemctl start helena-token-keeper.service', login['command'])
        # The next tick does not try the dead grant again.
        self.tick()
        self.assertEqual(len(self.anthropic_calls), 1)

    def test_a_failed_early_refresh_does_not_take_a_working_login_out_of_use(self):
        self.root.anthropic(2 * 3600).write()
        self.anthropic_answer = OSError('network is unreachable')
        status = self.tick()
        row = self.root.read()['credential_pool']['anthropic'][0]
        self.assertNotEqual(row.get('last_status'), 'exhausted')
        self.assertEqual(row['refresh_token'], 'rt-anthropic-0')
        login = self.login(status, 'anthropic')
        self.assertEqual(login['state'], 'error')
        # Backed off: the next tick right away does not try again.
        self.tick()
        self.assertEqual(len(self.anthropic_calls), 1)

    def test_refreshes_hermes_chatgpt_login_singleton_and_pool_alike(self):
        self.root.codex(2 * 3600).write()
        status = self.tick()
        self.assertEqual(self.codex_calls, ['rt-codex-0'])
        store = self.root.read()
        self.assertEqual(store['providers']['openai-codex']['tokens']['refresh_token'], 'rt-codex-1')
        rows = store['credential_pool'].get('openai-codex', [])
        self.assertTrue(rows)
        self.assertTrue(all(row.get('refresh_token') == 'rt-codex-1' for row in rows))
        self.assertEqual(self.login(status, 'openai-codex')['state'], 'ok')

    def test_a_codex_cli_login_on_the_same_chain_follows_hermes_refresh(self):
        self.root.codex(2 * 3600).write()
        self.root.codex_cli(access=self.root.store['providers']['openai-codex']['tokens']['access_token'],
                            refresh='rt-codex-0')
        status = self.tick()
        cli = json.loads((self.root.home / '.codex' / 'auth.json').read_text())
        self.assertEqual(cli['tokens']['refresh_token'], 'rt-codex-1')
        self.assertEqual(cli['tokens']['id_token'], 'cli-id-token')
        self.assertEqual(stat.S_IMODE((self.root.home / '.codex' / 'auth.json').stat().st_mode), 0o600)
        self.assertEqual(self.login(status, 'openai-codex', 'codex-cli')['note'], 'linked')

    def test_hermes_takes_over_a_pair_the_codex_cli_rotated_instead_of_spending_its_old_token(self):
        self.root.codex(2 * 3600).write()
        access = self.root.store['providers']['openai-codex']['tokens']['access_token']
        self.root.codex_cli(access=access, refresh='rt-codex-0')
        self.keeper().tick(refresh=False)  # linked
        # The Codex CLI refreshed on its own: new pair in its file, Hermes still holds the spent one.
        self.root.codex_cli(access=codex_token(10 * 86400, 7), refresh='rt-cli-rotated')
        self.tick()
        self.assertEqual(self.codex_calls, [])
        tokens = self.root.read()['providers']['openai-codex']['tokens']
        self.assertEqual(tokens['refresh_token'], 'rt-cli-rotated')

    def test_a_separate_codex_cli_login_is_reported_not_refreshed(self):
        self.root.codex(9 * 86400).write()
        self.root.codex_cli(access=codex_token(-60, 3), refresh='rt-other')
        status = self.tick()
        cli = json.loads((self.root.home / '.codex' / 'auth.json').read_text())
        self.assertEqual(cli['tokens']['refresh_token'], 'rt-other')
        login = self.login(status, 'openai-codex', 'codex-cli')
        self.assertEqual((login['note'], login['managed'], login['state']), ('separate', False, 'expired'))

    # ── what agents see ──

    def test_the_views_hold_no_refresh_token(self):
        self.root.anthropic(7 * 3600).codex(9 * 86400).write()
        self.root.codex_cli(access=codex_token(9 * 86400), refresh='rt-cli')
        self.tick()
        hermes_view = (self.root.state / 'view' / 'hermes' / 'auth.json').read_text()
        codex_view = (self.root.state / 'view' / 'codex' / 'auth.json').read_text()
        for text in (hermes_view, codex_view):
            self.assertNotIn('refresh_token', text)
            self.assertNotIn('rt-', text)
        self.assertIn('sk-ant-oat01-access-0', hermes_view)
        for path in (self.root.state / 'view' / 'hermes' / 'auth.json', self.root.state / 'view' / 'codex' / 'auth.json'):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o640)
        status_text = (self.root.state / 'status' / 'hermes.json').read_text()
        for secret in ('rt-', 'sk-ant', 'access-0'):
            self.assertNotIn(secret, status_text)

    def sandboxed(self, code: str) -> dict:
        """Runs `code` as Hermes in an isolated agent unit would: HERMES_HOME in a profile, the
        root auth.json being the keeper's view, the root read-only. Answers what `code` prints."""
        unit = Root()
        try:
            shutil.copy(self.root.state / 'view' / 'hermes' / 'auth.json', unit.home / 'auth.json')
            os.chmod(unit.home / 'auth.json', 0o444)
            os.chmod(unit.home, 0o555)
            script = (
                'import json, sys\n'
                'import agent.anthropic_credentials as a, hermes_cli.auth as h\n'
                'posts = []\n'
                'def boom(*args, **kwargs):\n'
                '    posts.append(1)\n'
                '    raise AssertionError("refresh POST")\n'
                'a.refresh_anthropic_oauth_pure = boom\n'
                'h.refresh_codex_oauth_pure = boom\n'
                'from agent.credential_pool import load_pool\n'
                'result = {}\n' + code + '\n'
                'result["posts"] = len(posts)\n'
                'print(json.dumps(result))\n'
            )
            env = {**os.environ, 'HERMES_HOME': str(unit.profile), 'HOME': str(unit.profile)}
            import subprocess
            run = subprocess.run([sys.executable, '-c', script], env=env, capture_output=True, text=True, timeout=120)
            self.assertEqual(run.returncode, 0, run.stderr[-2000:])
            return json.loads(run.stdout.strip().splitlines()[-1])
        finally:
            unit.cleanup()

    def test_an_isolated_agent_uses_the_access_token_and_can_never_spend_a_refresh_token(self):
        self.root.anthropic(7 * 3600).codex(9 * 86400).write()
        self.tick()
        result = self.sandboxed(
            'pool = load_pool("anthropic")\n'
            'entry = pool.select()\n'
            'result["anthropic"] = entry.access_token if entry else None\n'
            'result["forced"] = pool.try_refresh_matching(credential_id=entry.id) is not None\n'
            'result["codex"] = bool(h.resolve_codex_runtime_credentials().get("api_key"))\n'
        )
        self.assertEqual(result, {'anthropic': 'sk-ant-oat01-access-0', 'forced': False, 'codex': True, 'posts': 0})

    def test_hermes_doctor_in_the_profile_helper_sees_the_shared_login(self):
        # Agent → Laufzeit → "Prüfen" runs `hermes doctor` in the profile helper, which gets the
        # same views: its "OpenAI Codex auth" row must read logged in, as the runs are.
        self.root.codex(9 * 86400).write()
        self.tick()
        result = self.sandboxed('result["codex"] = h.get_codex_auth_status().get("logged_in")\n')
        self.assertEqual(result, {'codex': True, 'posts': 0})

    def test_the_binding_before_the_keeper_let_an_isolated_agent_spend_the_refresh_token(self):
        # The incident of 2026-09-24, as a control: the root auth.json itself (with its refresh
        # token) bound read-only into the unit, the access token expired.
        self.root.anthropic(-60).write()
        (self.root.state / 'view' / 'hermes').mkdir(parents=True)
        shutil.copy(self.root.home / 'auth.json', self.root.state / 'view' / 'hermes' / 'auth.json')
        result = self.sandboxed('result["anthropic"] = bool(load_pool("anthropic").select())\n')
        self.assertEqual(result['posts'], 1)

    def test_an_isolated_agent_with_an_expired_view_fails_closed_without_a_refresh(self):
        self.root.anthropic(7 * 3600).write()
        self.tick()
        view = self.view()
        view['credential_pool']['anthropic'][0]['expires_at_ms'] = int((time.time() - 60) * 1000)
        (self.root.state / 'view' / 'hermes' / 'auth.json').write_text(json.dumps(view))
        result = self.sandboxed('result["anthropic"] = bool(load_pool("anthropic").select())\n')
        self.assertEqual(result, {'anthropic': False, 'posts': 0})


@unittest.skipUnless(HERMES, 'Hermes is not importable here')
class CatalogWithHermes(unittest.TestCase):
    """The runner catalog offers a provider's models only while Hermes holds a login for it that
    is not dead (deployment/volition-stack/integration/scripts/volition-hermes-catalog.py)."""

    def setUp(self):
        self.root = Root()
        self.env = mock.patch.dict(os.environ, {'HERMES_HOME': str(self.root.home), 'HOME': str(self.root.home)})
        self.env.start()
        path = HERE.parents[1] / 'integration' / 'scripts' / 'volition-hermes-catalog.py'
        spec = importlib.util.spec_from_file_location('volition_hermes_catalog_for_keeper', path)
        self.catalog = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.catalog)

    def tearDown(self):
        self.env.stop()
        self.root.cleanup()

    def test_a_dead_login_is_not_logged_in(self):
        self.root.anthropic(-60, status='dead').write()
        self.assertFalse(self.catalog.logged_in('anthropic'))

    def test_a_live_login_is(self):
        self.root.anthropic(3600).write()
        self.assertTrue(self.catalog.logged_in('anthropic'))

    def test_one_live_login_next_to_a_dead_one_is_enough(self):
        self.root.anthropic(-60, status='dead').anthropic(3600, entry_id='def456', refresh='rt-2', access='sk-ant-oat01-b').write()
        self.assertTrue(self.catalog.logged_in('anthropic'))


if __name__ == '__main__':
    unittest.main()
