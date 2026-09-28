"""The boot check installs the pinned DKMS module only when the current kernel needs it."""

import os
import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'fans' / 'helena-fan-module-check'


class FanModuleCheckTests(unittest.TestCase):
    def run_check(self, status: str, modinfo_ok: bool) -> tuple[int, list[str]]:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            calls = root / 'calls'
            for name, body in {
                'uname': 'echo test-kernel',
                'dkms': f'echo "dkms $*" >> "$CALLS"\nif [ "$1" = status ]; then echo "{status}"; else exit 0; fi',
                'modinfo': f'echo "modinfo $*" >> "$CALLS"\nexit {0 if modinfo_ok else 1}',
                'modprobe': 'echo "modprobe $*" >> "$CALLS"',
            }.items():
                path = root / name
                path.write_text('#!/bin/sh\n' + body + '\n', encoding='utf-8')
                path.chmod(0o755)
            result = subprocess.run([str(SCRIPT)], env={**os.environ, 'PATH': str(root) + ':/usr/bin:/bin',
                                                     'CALLS': str(calls)}, capture_output=True, text=True)
            return result.returncode, calls.read_text().splitlines()

    def test_builds_for_a_new_kernel_then_loads(self):
        code, calls = self.run_check('', False)
        self.assertEqual(code, 0)
        self.assertIn('dkms install -m ec_su_axb35 -v f62c2c22 -k test-kernel', calls)
        self.assertEqual(calls[-1], 'modprobe ec_su_axb35')

    def test_installed_module_is_only_loaded(self):
        code, calls = self.run_check('ec_su_axb35/f62c2c22, test-kernel, x86_64: installed', True)
        self.assertEqual(code, 0)
        self.assertNotIn('dkms install -m ec_su_axb35 -v f62c2c22 -k test-kernel', calls)
        self.assertEqual(calls[-1], 'modprobe ec_su_axb35')

    def test_an_older_module_does_not_skip_the_pinned_build(self):
        code, calls = self.run_check('ec_su_axb35/20260403-e483ec9, test-kernel: installed', True)
        self.assertEqual(code, 0)
        self.assertIn('dkms install -m ec_su_axb35 -v f62c2c22 -k test-kernel', calls)
