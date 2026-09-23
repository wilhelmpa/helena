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


if __name__ == "__main__":
    unittest.main()
