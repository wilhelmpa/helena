import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).parents[1] / "scripts" / "volition-hermes-catalog.py"
SPEC = importlib.util.spec_from_file_location("volition_hermes_catalog", MODULE)
CATALOG = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CATALOG)


class HermesProjectBrowserCatalogTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.home = root / "hermes"
        self.descriptors = self.home / "run" / "agents"
        self.browsers = root / "browsers"
        self.project = self.browsers / "demo"
        for directory in (self.home, self.descriptors, self.browsers, self.project, self.project / "run"):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(directory, 0o700)
        (self.home / "config.yaml").write_text("model: {}\n", encoding="utf-8")
        os.chmod(self.home / "config.yaml", 0o600)
        descriptor = {
            "schemaVersion": 1,
            "projectId": 7,
            "teamId": 3,
            "planAgentId": 21,
            "username": "hermes-demo-coordinator",
            "cwd": str(root / "workspace"),
            "hermesHome": str(self.home / "profiles" / "demo"),
            "globalHermesHome": str(self.home),
            "browserCdpUrl": "http://127.0.0.1:19201",
            "apiKey": "private-test-key-000000000000",
        }
        (self.descriptors / "demo.json").write_text(json.dumps(descriptor), encoding="utf-8")
        os.chmod(self.descriptors / "demo.json", 0o600)
        self.state = {
            "schemaVersion": 1,
            "projectId": 7,
            "slug": "demo",
            "slot": 1,
            "display": 201,
            "cdpPort": 19201,
            "vncPort": 15901,
            "noVncPort": 16081,
        }
        self.write_browser_state(self.state)

    def tearDown(self):
        self.temp.cleanup()

    def write_browser_state(self, value):
        state = self.project / "runtime.json"
        state.write_text(json.dumps(value), encoding="utf-8")
        os.chmod(state, 0o600)
        xauthority = self.project / "run" / "Xauthority"
        xauthority.write_bytes(b"private-xauthority")
        os.chmod(xauthority, 0o600)

    def test_injects_only_loopback_cdp_and_project_display(self):
        [entry] = CATALOG.descriptor_entries(self.descriptors, self.home, self.browsers)
        self.assertEqual(entry["env"]["BROWSER_CDP_URL"], "http://127.0.0.1:19201")
        self.assertEqual(entry["env"]["DISPLAY"], ":201")
        self.assertEqual(entry["env"]["XAUTHORITY"], str(self.project / "run" / "Xauthority"))
        self.assertNotIn("apiKey", json.dumps(entry["env"]))

    def test_rejects_state_for_another_project(self):
        self.write_browser_state({**self.state, "projectId": 8})
        with self.assertRaisesRegex(RuntimeError, "conflicts"):
            CATALOG.descriptor_entries(self.descriptors, self.home, self.browsers)

    def test_rejects_a_descriptor_cdp_endpoint_that_differs_from_runtime_state(self):
        descriptor_path = self.descriptors / "demo.json"
        descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
        descriptor["browserCdpUrl"] = "http://127.0.0.1:19202"
        descriptor_path.write_text(json.dumps(descriptor), encoding="utf-8")
        os.chmod(descriptor_path, 0o600)
        with self.assertRaisesRegex(RuntimeError, "endpoint conflicts"):
            CATALOG.descriptor_entries(self.descriptors, self.home, self.browsers)

    def write_agent(self, name, **fields):
        descriptor = {
            "schemaVersion": 1,
            "projectId": 7,
            "teamId": 3,
            "planAgentId": 42,
            "username": "Coder.Bot",
            "cwd": str(Path(self.temp.name) / "workspace"),
            "hermesHome": str(self.home / "profiles" / name),
            "globalHermesHome": str(self.home),
            "browserCdpUrl": "http://127.0.0.1:19201",
            "apiKey": "private-agent-key-0000000000",
            **fields,
        }
        path = self.descriptors / f"{name}.json"
        path.write_text(json.dumps(descriptor), encoding="utf-8")
        os.chmod(path, 0o600)

    def test_runs_a_project_agent_in_its_own_profile_with_the_project_browser(self):
        self.write_agent("demo_42")
        coordinator, agent = CATALOG.descriptor_entries(self.descriptors, self.home, self.browsers)
        self.assertEqual(coordinator["name"], "hermes-demo-coordinator")
        self.assertEqual(agent["name"], "Coder.Bot")
        self.assertEqual(agent["env"]["HERMES_HOME"], str(self.home / "profiles" / "demo_42"))
        self.assertEqual(agent["env"]["BROWSER_CDP_URL"], "http://127.0.0.1:19201")
        self.assertEqual(agent["env"]["DISPLAY"], ":201")
        self.assertTrue((self.home / "profiles" / "demo_42" / "config.yaml").is_symlink())

    def test_rejects_a_project_agent_descriptor_that_does_not_match_its_name(self):
        for name, fields in (
            ("demo_42", {"planAgentId": 43}),
            ("demo_42", {"username": "../escape"}),
            ("demo_42", {"hermesHome": str(self.home / "profiles" / "demo")}),
            ("demo_42", {"username": "hermes-demo-coordinator", "hermesHome": str(self.home / "profiles" / "demo")}),
            ("demo_x42", {}),
            ("Demo_42", {"hermesHome": str(self.home / "profiles" / "Demo_42")}),
        ):
            with self.subTest(name=name, fields=fields):
                for stale in self.descriptors.glob("*_*.json"):
                    stale.unlink()
                self.write_agent(name, **fields)
                with self.assertRaisesRegex(RuntimeError, "conflicts"):
                    CATALOG.descriptor_entries(self.descriptors, self.home, self.browsers)

    def test_rejects_symlinked_browser_state(self):
        state = self.project / "runtime.json"
        state.unlink()
        foreign = Path(self.temp.name) / "foreign.json"
        foreign.write_text(json.dumps(self.state), encoding="utf-8")
        os.chmod(foreign, 0o600)
        state.symlink_to(foreign)
        with self.assertRaisesRegex(RuntimeError, "private regular file"):
            CATALOG.descriptor_entries(self.descriptors, self.home, self.browsers)


class HermesProfileCatalogTest(unittest.TestCase):
    def test_reports_mcp_servers_apart_from_toolsets(self):
        profile = CATALOG.split_profile({"web", "browser", "itsaplan", "file"}, {"itsaplan", "disabled"})
        self.assertEqual(profile, {"toolsets": ["browser", "file", "web"], "mcpServers": ["itsaplan"]})

    def test_requires_the_browser_toolset(self):
        CATALOG.require_browser_toolset({"toolsets": ["browser"], "mcpServers": []})
        with self.assertRaisesRegex(RuntimeError, "browser toolset"):
            CATALOG.require_browser_toolset({"toolsets": ["file"], "mcpServers": ["browser"]})


if __name__ == "__main__":
    unittest.main()
