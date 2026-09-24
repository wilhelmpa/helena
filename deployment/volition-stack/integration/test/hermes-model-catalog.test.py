import importlib.util
import unittest
from pathlib import Path

MODULE = Path(__file__).parents[1] / "scripts" / "volition-hermes-catalog.py"
SPEC = importlib.util.spec_from_file_location("volition_hermes_catalog", MODULE)
CATALOG = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CATALOG)


def model(model_id):
    return {"id": model_id, "name": model_id, "reasoning": False, "thinkingLevels": [], "thinkingDefault": None}


class HermesModelCatalogTest(unittest.TestCase):
    def setUp(self):
        self.original = (CATALOG.discover_catalog, CATALOG.logged_in)
        self.catalogs = {
            "openai-codex": [model("gpt-5.5"), model("shared")],
            "anthropic": [model("claude-sonnet-5"), model("shared")],
        }
        CATALOG.discover_catalog = lambda provider: self.catalogs[provider]
        CATALOG.logged_in = lambda provider: True

    def tearDown(self):
        CATALOG.discover_catalog, CATALOG.logged_in = self.original

    def test_lists_each_logged_in_provider_with_its_models_marked(self):
        models = CATALOG.catalog_models("openai-codex")
        self.assertEqual(
            [(entry["id"], entry["provider"]) for entry in models],
            [("gpt-5.5", "openai-codex"), ("shared", "openai-codex"), ("claude-sonnet-5", "anthropic")],
        )

    def test_leaves_out_a_provider_without_login(self):
        CATALOG.logged_in = lambda provider: False
        self.assertEqual([entry["id"] for entry in CATALOG.catalog_models("openai-codex")], ["gpt-5.5", "shared"])

    def test_an_unreadable_additional_provider_does_not_stop_the_catalog(self):
        def discover(provider):
            if provider == "anthropic":
                raise RuntimeError("listing failed")
            return self.catalogs[provider]

        CATALOG.discover_catalog = discover
        self.assertEqual(len(CATALOG.catalog_models("openai-codex")), 2)

    def test_the_configured_provider_is_still_required(self):
        def discover(provider):
            raise RuntimeError("listing failed")

        CATALOG.discover_catalog = discover
        with self.assertRaises(RuntimeError):
            CATALOG.catalog_models("openai-codex")

    def test_names_read_as_versions_without_release_dates(self):
        self.assertEqual(CATALOG.model_name("claude-opus-4-5-20251101"), "Claude Opus 4.5")
        self.assertEqual(CATALOG.model_name("claude-opus-4-20250514"), "Claude Opus 4")
        self.assertEqual(CATALOG.model_name("claude-fable-5.1"), "Claude Fable 5.1")
        self.assertEqual(CATALOG.model_name("gpt-5.5"), "GPT 5.5")
        self.assertEqual(CATALOG.model_name("gpt-5-codex"), "GPT 5 Codex")

    def test_keeps_one_model_per_name_within_a_provider(self):
        self.catalogs["anthropic"] = [
            {**model("claude-fable-5-1"), "name": "Claude Fable 5.1"},
            {**model("claude-fable-5.1"), "name": "Claude Fable 5.1"},
        ]
        ids = [entry["id"] for entry in CATALOG.catalog_models("openai-codex")]
        self.assertEqual(ids, ["gpt-5.5", "shared", "claude-fable-5-1"])




class RuntimeFixture:
    """A Hermes home with one project agent's descriptor and a runner template."""

    def setUp(self):
        import json
        import os
        import tempfile

        self.json = json
        self.os = os
        self.dir = Path(tempfile.mkdtemp()).resolve()
        self.home = self.dir / 'hermes'
        (self.home / 'profiles').mkdir(parents=True)
        (self.home / 'config.yaml').write_text('model: {}\n')
        self.descriptors = self.home / 'run' / 'agents'
        self.descriptors.mkdir(parents=True, mode=0o700)
        os.chmod(self.home / 'run', 0o700)
        descriptor = {
            'schemaVersion': 1,
            'username': 'writer',
            'hermesHome': str(self.home / 'profiles' / 'alpha_7'),
            'globalHermesHome': str(self.home),
            'apiKey': 'k' * 32,
            'cwd': '/srv/volition/workspaces/projects/alpha',
            'projectId': 3,
            'teamId': 1,
            'planAgentId': 7,
        }
        path = self.descriptors / 'alpha_7.json'
        path.write_text(json.dumps(descriptor))
        os.chmod(path, 0o600)
        self.template = self.dir / 'template.json'
        self.template.write_text(json.dumps({'url': 'http://127.0.0.1:3000', 'agent': 'hermes'}))
        self.saved = (CATALOG.configured_route, CATALOG.catalog_models, os.environ.get('AGENT_ISOLATION'),
                      os.environ.get('ITSAPLAN_API_KEY'))
        CATALOG.configured_route = lambda: ('', None)
        CATALOG.catalog_models = lambda provider: []
        os.environ['ITSAPLAN_API_KEY'] = 'h' * 32

    def tearDown(self):
        import shutil

        CATALOG.configured_route, CATALOG.catalog_models, isolation, key = self.saved
        for name, value in (('AGENT_ISOLATION', isolation), ('ITSAPLAN_API_KEY', key)):
            if value is None:
                self.os.environ.pop(name, None)
            else:
                self.os.environ[name] = value
        shutil.rmtree(self.dir)

    def runtime(self):
        output = self.dir / 'out' / 'runner.json'
        CATALOG.write_runtime(self.template, output, self.descriptors, self.home,
                              {'toolsets': ['terminal'], 'mcpServers': []}, None, self.dir / 'plugins')
        return self.json.loads(output.read_text())


class IsolatedRuntimeTest(RuntimeFixture, unittest.TestCase):
    """With AGENT_ISOLATION=on the runner config names each agent's project and profile, the
    catalog writes nothing into the profiles, and Home gets a profile and workspace of its own."""

    def test_names_project_and_profile_and_leaves_profiles_alone(self):
        self.os.environ['AGENT_ISOLATION'] = 'on'
        agents = self.runtime()['agents']
        home, writer = agents
        self.assertEqual(home['isolation'], {'slug': 'home', 'profile': 'home', 'agentId': None})
        self.assertEqual(home['env']['HERMES_HOME'], str(self.home / 'profiles' / 'home'))
        self.assertEqual(home['cwd'], CATALOG.HOME_WORKSPACE)
        self.assertEqual(writer['isolation'], {'slug': 'alpha', 'profile': 'alpha_7', 'agentId': 7})
        self.assertNotIn('BROWSER_CDP_URL', writer['env'])
        # Nothing was created in the profile: it is the project user's.
        self.assertFalse((self.home / 'profiles' / 'alpha_7').exists())

    def test_a_home_whose_config_is_a_file_does_not_stop_the_runner(self):
        # 2026-09-24: a hand edit replaced the link with a file in every profile; the next
        # start stopped the whole runner. Now the runner puts the link back (policy.ts).
        self.os.environ.pop('AGENT_ISOLATION', None)
        plugin = self.dir / 'plugins' / 'plan-approval-guard'
        plugin.mkdir(parents=True)
        (plugin / '__init__.py').write_text('')
        profile = self.home / 'profiles' / 'alpha_7'
        profile.mkdir(parents=True, mode=0o700)
        (profile / 'config.yaml').write_text('mcp_servers: {}\n')
        runtime = self.runtime()
        home, writer = runtime['agents']
        self.assertEqual(writer['name'], 'writer')
        self.assertFalse((profile / 'config.yaml').is_symlink())
        self.assertEqual(writer['hermes']['sharedConfig'], str(self.home / 'config.yaml'))
        self.assertNotIn('sharedConfig', home.get('hermes', {}))
        self.assertEqual(runtime['helenaProblems'], [])

    def test_leaves_out_an_agent_it_cannot_serve_and_names_it(self):
        self.os.environ.pop('AGENT_ISOLATION', None)
        plugin = self.dir / 'plugins' / 'plan-approval-guard'
        plugin.mkdir(parents=True)
        (plugin / '__init__.py').write_text('')
        broken = self.descriptors / 'alpha_8.json'
        broken.write_text(self.json.dumps({'schemaVersion': 1, 'planAgentId': 9}))
        self.os.chmod(broken, 0o600)
        runtime = self.runtime()
        self.assertEqual([agent['name'] for agent in runtime['agents']], ['hermes-home-master', 'writer'])
        self.assertEqual(runtime['helenaProblems'],
                         ['alpha_8: Hermes runner descriptor conflicts with its project'])

    def test_without_isolation_nothing_changes(self):
        self.os.environ.pop('AGENT_ISOLATION', None)
        plugin = self.dir / 'plugins' / 'plan-approval-guard'
        plugin.mkdir(parents=True)
        (plugin / '__init__.py').write_text('')
        agents = self.runtime()['agents']
        self.assertNotIn('isolation', agents[0])
        self.assertEqual(agents[0]['env']['HERMES_HOME'], str(self.home))
        self.assertTrue((self.home / 'profiles' / 'alpha_7' / 'config.yaml').is_symlink())


class CliRuntimeCatalogTest(RuntimeFixture, unittest.TestCase):
    """A descriptor that names Claude Code or Codex becomes a runner entry of that preset, in
    the agent's profile directory as its home, with nothing of Hermes linked into it."""

    def setUp(self):
        super().setUp()
        for name, agent_id, runtime in (('alpha_21', 21, 'claude'), ('alpha_22', 22, 'codex')):
            descriptor = {
                'schemaVersion': 1,
                'username': f'{runtime}-coder',
                'hermesHome': str(self.home / 'profiles' / name),
                'globalHermesHome': str(self.home),
                'apiKey': 'c' * 32,
                'cwd': '/srv/volition/workspaces/projects/alpha',
                'projectId': 3,
                'teamId': 1,
                'planAgentId': agent_id,
                'runtime': runtime,
            }
            path = self.descriptors / f'{name}.json'
            path.write_text(self.json.dumps(descriptor))
            self.os.chmod(path, 0o600)
        self.template.write_text(self.json.dumps({
            'url': 'http://127.0.0.1:3000', 'agent': 'hermes', 'args': ['--checkpoints'],
            'concurrency': 3, 'timeoutMs': 1800000,
        }))
        CATALOG.configured_route = lambda: ('openai-codex', None)
        CATALOG.catalog_models = lambda provider: [
            {**model('gpt-5.6-luna'), 'provider': 'openai-codex'},
            {**model('claude-opus-5-5'), 'provider': 'anthropic'},
        ]
        plugin = self.dir / 'plugins' / 'plan-approval-guard'
        plugin.mkdir(parents=True)
        (plugin / '__init__.py').write_text('')

    def entries(self):
        return {agent['name']: agent for agent in self.runtime()['agents']}

    def test_serves_claude_code_and_codex_agents_in_their_own_homes(self):
        self.os.environ.pop('AGENT_ISOLATION', None)
        agents = self.entries()
        claude, codex = agents['claude-coder'], agents['codex-coder']
        claude_home = self.home / 'profiles' / 'alpha_21'
        self.assertEqual(claude['agent'], 'claude')
        self.assertEqual(claude['args'], [])
        self.assertEqual(claude['env']['HELENA_AGENT_HOME'], str(claude_home))
        self.assertEqual(claude['env']['CLAUDE_CONFIG_DIR'], str(claude_home / '.claude'))
        self.assertNotIn('HERMES_HOME', claude['env'])
        self.assertNotIn('hermes', claude)
        self.assertNotIn('provider', claude)
        self.assertEqual(claude['concurrency'], 3)
        self.assertEqual([m['id'] for m in claude['models']], ['fable', 'opus', 'sonnet', 'haiku'])
        self.assertEqual(codex['agent'], 'codex')
        self.assertEqual(codex['env']['CODEX_HOME'], str(self.home / 'profiles' / 'alpha_22' / '.codex'))
        # Codex offers the models of the ChatGPT Codex backend Hermes lists, not Anthropic's.
        self.assertEqual([m['id'] for m in codex['models']], ['gpt-5.6-luna'])
        self.assertNotIn('provider', codex['models'][0])
        # Its home exists, private, and holds no Hermes link.
        self.assertEqual(claude_home.stat().st_mode & 0o777, 0o700)
        self.assertFalse((claude_home / 'config.yaml').exists())
        self.assertFalse((claude_home / 'plugins').exists())
        # The Hermes agent next to them is served as before.
        self.assertEqual(agents['writer']['agent'], 'hermes')
        self.assertEqual(agents['writer']['args'], ['--checkpoints'])

    def test_isolated_agents_name_their_project_and_profile(self):
        self.os.environ['AGENT_ISOLATION'] = 'on'
        claude = self.entries()['claude-coder']
        self.assertEqual(claude['isolation'], {'slug': 'alpha', 'profile': 'alpha_21', 'agentId': 21})
        # The profile is the project user's: the catalog creates nothing in it.
        self.assertFalse((self.home / 'profiles' / 'alpha_21').exists())

    def test_leaves_out_a_descriptor_with_an_unknown_runtime(self):
        self.os.environ.pop('AGENT_ISOLATION', None)
        path = self.descriptors / 'alpha_21.json'
        descriptor = self.json.loads(path.read_text())
        descriptor['runtime'] = 'opencode'
        path.write_text(self.json.dumps(descriptor))
        runtime = self.runtime()
        self.assertNotIn('claude-coder', [agent['name'] for agent in runtime['agents']])
        self.assertEqual(runtime['helenaProblems'],
                         ['alpha_21: Hermes runner descriptor names an unknown runtime'])


if __name__ == '__main__':
    unittest.main()
