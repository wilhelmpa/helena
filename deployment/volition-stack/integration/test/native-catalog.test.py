import builtins
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('volition_catalog', Path(__file__).parents[1] / 'scripts' / 'volition-hermes-catalog.py')
CATALOG = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CATALOG)


class NativeCatalogTest(unittest.TestCase):
    def test_catalog_without_hermes_installation_or_imports(self):
        original_import = builtins.__import__
        def guarded_import(name, *args, **kwargs):
            if name.startswith(('hermes', 'tools')):
                raise AssertionError('Hermes dependency: ' + name)
            return original_import(name, *args, **kwargs)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            descriptors = root / 'run' / 'agents'
            descriptors.mkdir(parents=True)
            template = root / 'template.json'
            output = root / 'output.json'
            models = [{'id': 'flash', 'provider': 'helena-halogen', 'name': 'Flash'}, {'id': 'cloud', 'provider': 'openai', 'name': 'Cloud'}]
            template.write_text(json.dumps({'url': 'http://127.0.0.1:3000', 'agent': 'hermes', 'hermes': {'toolsets': ['terminal']}, 'models': models}))
            with patch.dict(os.environ, {'ITSAPLAN_API_KEY': 'synthetic-catalog-test-key', 'AGENT_ISOLATION': 'on'}), patch('builtins.__import__', guarded_import):
                result = CATALOG.write_runtime(template, output, descriptors, root, {}, native=True)
            payload = json.loads(output.read_text())
            self.assertEqual(result, ('', 2, 1))
            self.assertNotIn('hermes', payload)
            self.assertEqual(payload['agent'], 'helena')
            self.assertEqual(payload['agents'][0]['agent'], 'helena')
            self.assertNotIn('HERMES_HOME', payload['agents'][0]['env'])
            self.assertEqual(payload['agents'][0]['models'], models)
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)

    def test_home_can_switch_before_the_mixed_catalog_is_retired(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            descriptors = root / 'agents'
            descriptors.mkdir()
            template, output = root / 'template.json', root / 'output.json'
            template.write_text(json.dumps({'url': 'http://127.0.0.1:3000', 'agent': 'hermes'}))
            with patch.dict(os.environ, {'ITSAPLAN_API_KEY': 'synthetic-catalog-test-key', 'AGENT_ISOLATION': 'on'}), \
                 patch.object(CATALOG, 'configured_route', return_value=('', None)), \
                 patch.object(CATALOG, 'catalog_models', return_value=[]), \
                 patch.object(CATALOG, 'plan_plugins', return_value={}):
                CATALOG.write_runtime(template, output, descriptors, root, {}, home_runtime='helena')
            payload = json.loads(output.read_text())
            self.assertEqual(payload['agent'], 'hermes')
            self.assertEqual(payload['agents'][0]['agent'], 'helena')
            self.assertEqual(payload['agents'][0]['args'], [])
            self.assertNotIn('HERMES_HOME', payload['agents'][0]['env'])

    def test_models_come_from_native_policy_and_include_cloud_fallback(self):
        policy = {'localAi': {'servers': [{'provider': 'helena-halogen', 'models': [{'id': 'flash', 'contextLength': 262144}]}]},
                  'model': 'helena-halogen/flash', 'hermes': {'fallbackModels': [{'provider': 'openai', 'model': 'cloud'}]}}
        models = CATALOG.policy_models(policy, [])
        self.assertEqual([(model['provider'], model['id']) for model in models], [('helena-halogen', 'flash'), ('openai', 'cloud')])

    def test_requires_explicit_models_and_preserves_provider_identity(self):
        with self.assertRaises(RuntimeError):
            CATALOG.native_catalog_models([])
        with self.assertRaises(RuntimeError):
            CATALOG.native_catalog_models([{'id': 'flash'}])
        models = [{'id': 'same', 'provider': 'openai'}, {'id': 'same', 'provider': 'anthropic'}]
        self.assertEqual(CATALOG.native_catalog_models(models + [models[0]]), models)


if __name__ == '__main__':
    unittest.main()
