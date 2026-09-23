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




class IsolatedRuntimeTest(unittest.TestCase):
    """With AGENT_ISOLATION=on the runner config names each agent's project and profile, the
    catalog writes nothing into the profiles, and Home gets a profile and workspace of its own."""

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

    def test_without_isolation_nothing_changes(self):
        self.os.environ.pop('AGENT_ISOLATION', None)
        plugin = self.dir / 'plugins' / 'plan-approval-guard'
        plugin.mkdir(parents=True)
        (plugin / '__init__.py').write_text('')
        agents = self.runtime()['agents']
        self.assertNotIn('isolation', agents[0])
        self.assertEqual(agents[0]['env']['HERMES_HOME'], str(self.home))
        self.assertTrue((self.home / 'profiles' / 'alpha_7' / 'config.yaml').is_symlink())


if __name__ == '__main__':
    unittest.main()
