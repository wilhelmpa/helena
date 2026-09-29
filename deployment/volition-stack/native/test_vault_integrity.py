import importlib.util
import os
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
