import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('local_owner', Path(__file__).resolve().parents[1] / 'configure.py')
configure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure)


class PersonalMode(unittest.TestCase):
    def test_lan_and_kiosk_receive_no_capability_in_personal_map(self):
        rendered = configure.owner_map('home.example.test', '443', '')
        rules = [line for line in rendered.splitlines() if '443:0' in line or '8088:' in line]
        self.assertEqual(len(rules), 2)
        self.assertTrue(all(line.endswith('"";') for line in rules))

    def test_compatibility_map_retains_source_and_listener_guards(self):
        rendered = configure.owner_map('home.example.test', '443', 'fixture-token')
        self.assertIn('"home.example.test:1:443:0" "fixture-token";', rendered)
        self.assertNotIn('127.0.0.1 1;', rendered)
        self.assertIn('default "";', rendered)


if __name__ == '__main__':
    unittest.main()
