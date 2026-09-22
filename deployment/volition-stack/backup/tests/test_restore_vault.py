#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
RESTORE = ROOT / 'restore-vault.py'
MANIFEST = ROOT / 'vault-manifest.py'


class VaultRestoreTest(unittest.TestCase):
    def fixture(self, owner='owner@example.invalid', invitations=1, ciphers=2, attachments=1):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        data = root / 'vaultwarden'
        data.mkdir()
        database = data / 'db.sqlite3'
        with sqlite3.connect(database) as connection:
            connection.executescript('''
                create table users(email text not null);
                create table ciphers(uuid text);
                create table invitations(email text);
                create table attachments(id text);
            ''')
            connection.execute('insert into users values (?)', (owner,))
            connection.executemany('insert into invitations values (?)', [(owner,)] * invitations)
            connection.executemany('insert into ciphers values (?)', [(str(i),) for i in range(ciphers)])
            connection.executemany('insert into attachments values (?)', [(str(i),) for i in range(attachments)])
        archive = root / 'vault.tar'
        with tarfile.open(archive, 'w') as handle:
            handle.add(data, arcname='vaultwarden')
        manifest = root / 'manifest.json'
        subprocess.run(['python3', str(MANIFEST), '--database', str(database), '--archive', str(archive), '--output', str(manifest)], check=True)
        return temporary, archive, manifest

    def restore(self, archive, manifest):
        return subprocess.run(['python3', str(RESTORE), str(archive), str(manifest)], text=True, capture_output=True)

    def test_exact_manifest_passes_without_disclosing_owner_hash(self):
        temporary, archive, manifest = self.fixture()
        with temporary:
            result = self.restore(archive, manifest)
            self.assertEqual(result.returncode, 0, result.stderr)
            parsed = json.loads(result.stdout)
            self.assertTrue(parsed['manifestVerified'])
            self.assertEqual(parsed['users'], 1)
            self.assertEqual(parsed['invitations'], 1)
            private_hash = json.loads(manifest.read_text())['ownerIdentifierHash']
            self.assertNotIn(private_hash, result.stdout + result.stderr)
            self.assertNotIn('owner@example.invalid', result.stdout + result.stderr)

    def test_wrong_owner_hash_is_rejected(self):
        temporary, archive, manifest = self.fixture()
        with temporary:
            data = json.loads(manifest.read_text())
            data['ownerIdentifierHash'] = hashlib.sha256(b'wrong@example.invalid').hexdigest()
            manifest.write_text(json.dumps(data))
            result = self.restore(archive, manifest)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('owner identifier differs', result.stderr)

    def test_missing_invitation_is_rejected(self):
        temporary, archive, manifest = self.fixture(invitations=0)
        with temporary:
            data = json.loads(manifest.read_text())
            data['counts']['invitations'] = 1
            manifest.write_text(json.dumps(data))
            result = self.restore(archive, manifest)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('counters differ', result.stderr)

    def test_tampered_counter_is_rejected(self):
        temporary, archive, manifest = self.fixture(ciphers=2)
        with temporary:
            data = json.loads(manifest.read_text())
            data['counts']['ciphers'] = 3
            manifest.write_text(json.dumps(data))
            result = self.restore(archive, manifest)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('counters differ', result.stderr)


if __name__ == '__main__':
    unittest.main()
