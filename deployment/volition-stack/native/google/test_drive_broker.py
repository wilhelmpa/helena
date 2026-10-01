import base64
import runpy
import unittest
from pathlib import Path
from unittest.mock import patch

broker = runpy.run_path(str(Path(__file__).with_name('helena-google-broker')))
handle = broker['handle']


class DriveBrokerTest(unittest.TestCase):
    def request(self, command, args, **extra):
        return {'op': 'run', 'email': 'test@example.com', 'command': command, 'args': args, **extra}

    def test_search_preserves_pagination_and_pins_account(self):
        calls = []
        def fake(args, stdin=None):
            calls.append(args)
            return '{"files":[],"nextPageToken":"next"}'
        with patch.dict(handle.__globals__, gog=fake):
            result = handle(self.request('drive.search', ['drive', 'search', 'sharedWithMe', '--raw-query', '--page=page']))
        self.assertEqual(result, {'files': [], 'nextPageToken': 'next'})
        self.assertIn('test@example.com', calls[0])
        self.assertIn('--enable-commands-exact', calls[0])
        self.assertNotIn('--results-only', calls[0])

    def test_download_uses_private_temporary_path_and_removes_it(self):
        paths = []
        def fake(args, stdin=None):
            output = Path(next(arg[6:] for arg in args if arg.startswith('--out=')))
            paths.append(output)
            self.assertEqual(output.parent.stat().st_mode & 0o777, 0o700)
            output.write_bytes(b'PDF bytes')
            return '{}'
        with patch.dict(handle.__globals__, gog=fake):
            result = handle(self.request('drive.download', ['drive', 'download', 'file', '--format=pdf']))
        self.assertEqual(base64.b64decode(result['base64']), b'PDF bytes')
        self.assertFalse(paths[0].exists())

    def test_download_size_limit_cleans_up(self):
        paths = []
        def fake(args, stdin=None):
            output = Path(next(arg[6:] for arg in args if arg.startswith('--out=')))
            paths.append(output)
            output.write_bytes(b'12345')
            return '{}'
        with patch.dict(handle.__globals__, gog=fake, MAX_DRIVE_BYTES=4):
            with self.assertRaisesRegex(broker['Refused'], '50 MB'):
                handle(self.request('drive.download', ['drive', 'download', 'file']))
        self.assertFalse(paths[0].exists())

    def test_missing_content_returns_a_broker_error_and_cleans_up(self):
        paths = []
        def fake(args, stdin=None):
            paths.append(Path(next(arg[6:] for arg in args if arg.startswith('--out='))))
            return '{}'
        with patch.dict(handle.__globals__, gog=fake):
            with self.assertRaisesRegex(broker['Refused'], 'no readable Drive content'):
                handle(self.request('drive.download', ['drive', 'download', 'file']))
        self.assertFalse(paths[0].parent.exists())

    def test_rejects_caller_paths_account_overrides_mutations_and_stdin(self):
        for command, args, extra in [
            ('drive.download', ['drive', 'download', 'file', '--out=/tmp/owner'], {}),
            ('drive.download', ['drive', 'download', 'file', '--format=pdfjunk'], {}),
            ('drive.get', ['drive', 'get', 'file', '--account=other@example.com'], {}),
            ('drive.get', ['drive', 'get', 'file'], {'stdin': 'input'}),
            ('drive.share', ['drive', 'share', 'file'], {}),
            ('drive.delete', ['drive', 'delete', 'file'], {}),
        ]:
            with self.subTest(command=command, args=args):
                with self.assertRaises(broker['Refused']):
                    handle(self.request(command, args, **extra))


if __name__ == '__main__':
    unittest.main()
