"""Check public update backups and secret file permissions without reading their contents."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

AUDIT = (Path(__file__).resolve().parents[1] / 'audit.sh').read_text()
CHECK = AUDIT[AUDIT.index('  wide=()'):AUDIT.index('\nelse\n  need_root files.backups')]


class SecretFilesAuditTests(unittest.TestCase):
    def audit(self, name, mode=0o644):
        with tempfile.TemporaryDirectory(prefix='volition-secret-audit-') as folder:
            path = Path(folder) / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()
            path.chmod(mode)
            check = CHECK.replace('key=/etc/volition/owner-terminal.key', 'key="$SECRET_DIRS/missing-owner.key"')
            result = subprocess.run(
                ['bash', '-c', 'set -uo pipefail\nrecord() { printf "%s|%s|%s\\n" "$1" "$4" "$5"; }\n' + check],
                env={**os.environ, 'SECRET_DIRS': folder},
                capture_output=True, text=True, timeout=5,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return result.stdout.strip()

    def test_public_update_config_and_dated_backup_pass(self):
        for name in ('update.json', 'update.json.bak-20261001'):
            with self.subTest(name=name):
                self.assertIn('files.secrets|pass|', self.audit(name))

    def test_other_backups_and_similar_names_still_fail(self):
        for name in ('plan.env', 'token.key.bak-20261001', 'credentials.json.bak-20261001',
                     'update.json.bak-20261001.env', 'update.json.bak-latest',
                     'private/update.json.bak-20261001'):
            with self.subTest(name=name):
                self.assertIn('files.secrets|fail|', self.audit(name))

    def test_private_backups_pass(self):
        self.assertIn('files.secrets|pass|', self.audit('credentials.json.bak-20261001', 0o600))


if __name__ == '__main__':
    unittest.main()
