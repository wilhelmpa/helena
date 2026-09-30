import importlib.util
import json
import os
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


module_path = Path(__file__).with_name('vault-integrity.py')
spec = importlib.util.spec_from_file_location('vault_integrity', module_path)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class VaultIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('Home', 'Projects/ABC', 'Private'):
            (self.root / name).mkdir(parents=True)
        (self.root / 'Home/note.md').write_text('note')
        (self.root / 'Projects/ABC/file.txt').write_text('file')
        (self.root / 'Private/private.md').write_text('private')
        self.index = [dict(path=path, kind=kind) for path, kind in (
            ('Home', 'folder'), ('Home/note.md', 'note'), ('Projects', 'folder'),
            ('Projects/ABC', 'folder'), ('Projects/ABC/file.txt', 'file'),
            ('Private', 'folder'), ('Private/private.md', 'note'))]
        self.backup = {'paths': ['/srv/volition/vault/Home/note.md',
                                 '/srv/volition/vault/Private/private.md'], 'sample_ok': True}
        self.git = {name: {'fsck': True, 'dirty': False, 'bytes': 100} for name in ('shared', 'private')}

    def codes(self, **overrides):
        options = dict(root=self.root, index=self.index, receipts=[], backup=self.backup, git=self.git)
        options.update(overrides)
        return {item['code'] for item in audit.scan(**options)['findings']}

    def test_clean_and_index_faults(self):
        self.assertEqual(self.codes(), set())
        self.assertIn('index_without_file', self.codes(index=self.index + [{'path': 'Home/gone.md', 'kind': 'note'}]))
        self.assertIn('duplicate_index', self.codes(index=self.index + [self.index[1]]))
        self.assertIn('duplicate_index_case', self.codes(index=self.index + [{'path': 'Home/NOTE.md', 'kind': 'note'}]))
        self.assertIn('noncanonical_index', self.codes(index=self.index + [{'path': 'Home/../bad', 'kind': 'file'}]))
        (self.root / 'Home/new.md').write_text('new')
        self.assertIn('file_without_index', self.codes())
        os.link(self.root / 'Home/note.md', self.root / 'Home/hardlink.md')
        self.assertIn('duplicate_file', self.codes())
        (self.root / 'Home/NOTE.md').write_text('case')
        (self.root / 'Home/bad.md ').write_text('bad')
        self.assertIn('duplicate_file_case', self.codes())
        self.assertIn('noncanonical_file', self.codes())

    def test_backup_report_states_preserve_other_checks(self):
        for state, code in (('disabled', 'backup_disabled'), ('no_snapshot', 'backup_no_snapshot'),
                            ('stale', 'backup_stale'), ('unavailable', 'backup_unavailable'),
                            ('error', 'backup_check_failed')):
            with self.subTest(state=state):
                report = audit.scan(self.root, self.index, [], backup={'state': state}, git=self.git)
                self.assertEqual(report['state'], 'down')
                self.assertEqual({item['code'] for item in report['findings']}, {code})
                self.assertIn('git_dirty', self.codes(backup={'state': state},
                              git={**self.git, 'shared': {'fsck': True, 'dirty': True}}))
        self.assertEqual(self.codes(backup={'state': 'ok', 'vault_present': True,
                                         'private_present': True, 'sample_ok': True}), set())

    def test_backup_paths_require_vault_prefix(self):
        paths = ['/old/srv/volition/vault/Private/secret.md', '/srv/volition/vault-other/file']
        self.assertTrue({'backup_missing', 'backup_private_missing'} <=
                        self.codes(backup={'paths': paths, 'sample_ok': True}))

    def test_backup_uses_hostd_and_handles_unavailable_helper(self):
        with patch.object(audit, 'call', return_value={'parameters': {'result': {'state': 'no_snapshot'}}}) as call:
            self.assertEqual(audit.backup_state(), {'state': 'no_snapshot'})
            call.assert_called_once_with('/run/helena-hostd/hostd.sock',
                                         'io.helena.hostd.VaultBackupIntegrity', timeout=600)
        for reply in ({}, None, {'parameters': None}, {'error': 'org.varlink.service.MethodNotFound'},
                      {'parameters': {'result': {'state': 'unknown'}}}):
            with patch.object(audit, 'call', return_value=reply):
                self.assertEqual(audit.backup_state(), {'state': 'error'})
        with patch.object(audit, 'call', side_effect=OSError('test socket missing')):
            self.assertEqual(audit.backup_state(), {'state': 'error'})

    def test_no_backup_check_is_pending(self):
        result = audit.scan(self.root, self.index, [], backup=None, git=self.git)
        self.assertEqual(result['state'], 'unknown')
        self.assertEqual(result['findings'], [{'code': 'backup_unchecked', 'path': 'Vault', 'detail': ''}])

    def test_findings_write_report_with_successful_exit(self):
        with tempfile.TemporaryDirectory() as output:
            fixture = Path(output) / 'fixture.json'
            report = Path(output) / 'report.json'
            for state, code in (('disabled', 'backup_disabled'), ('no_snapshot', 'backup_no_snapshot')):
                fixture.write_text(json.dumps({'index': self.index, 'receipts': [],
                                              'backup': {'state': state}, 'git': self.git}))
                argv = ['vault-integrity.py', '--root', str(self.root), '--fixture', str(fixture),
                        '--report', str(report)]
                with patch.object(sys, 'argv', argv), patch('builtins.print'):
                    self.assertEqual(audit.main(), 0)
                self.assertEqual(json.loads(report.read_text())['state'], 'down')
                self.assertEqual(json.loads(report.read_text())['findings'],
                                 [{'code': code, 'path': 'Vault', 'detail': ''}])
        with patch.object(sys, 'argv', ['vault-integrity.py', '--root', str(self.root)]), \
                patch.object(audit, 'database_rows', side_effect=RuntimeError('test failure')), \
                patch('builtins.print'):
            self.assertEqual(audit.main(), 1)

    def test_native_systemd_has_no_old_operator_paths(self):
        for folder in (module_path.parent / 'systemd', module_path.parent / 'server' / 'systemd'):
            for unit in folder.rglob('*'):
                if unit.is_file():
                    self.assertNotIn('/home/pw', unit.read_text(), str(unit))
        unit = (module_path.parent / 'systemd' / 'volition-vault-integrity.service').read_text()
        self.assertNotIn('RESTIC_', unit)
        self.assertIn('Requires=helena-hostd.socket', unit)
        self.assertIn('InaccessiblePaths=-/etc/helena/backup -/var/backups/helena', unit)

    def test_files_and_receipts(self):
        (self.root / 'Home/empty.md').touch()
        (self.root / 'Home/stale.tmp').write_text('half')
        (self.root / 'Home/note.sync-conflict-20260929-180500-ABCDEFG.md').write_text('conflict')
        (self.root / 'Home/note.md').chmod(0o666)
        codes = self.codes(receipts=[{'vault_path': 'Projects/ABC/file.txt', 'sha256': '0' * 64},
                                      {'vault_path': 'Projects/ABC/missing.pdf', 'sha256': '0' * 64}])
        self.assertTrue({'zero_byte', 'partial_upload', 'sync_conflict', 'world_writable',
                         'receipt_sha', 'receipt_missing'} <= codes)
        (self.root / '.trash').mkdir()
        hidden = self.root / '.trash/old.txt'
        hidden.write_text('old')
        hidden.chmod(0o666)
        report = audit.scan(self.root, self.index, [], backup=self.backup, git=self.git)
        self.assertIn({'code': 'world_writable', 'path': '.trash/old.txt', 'detail': ''}, report['findings'])

    def test_git_backup_and_acl(self):
        git = {**self.git, 'private': {'fsck': False, 'dirty': True, 'bytes': 3 * 1024**3}}
        codes = self.codes(git=git, backup={'paths': [], 'sample_ok': False})
        self.assertTrue({'git_fsck', 'git_dirty', 'git_size', 'backup_missing',
                         'backup_private_missing', 'backup_restore'} <= codes)
        with patch.object(audit, 'command', return_value='user:vp-other:rwx\n'):
            codes = self.codes(project_users={'ABC': 'vp-abc', 'XYZ': 'vp-other'})
        self.assertTrue({'home_acl', 'project_acl', 'foreign_project_acl', 'project_missing'} <= codes)


if __name__ == '__main__':
    unittest.main()
