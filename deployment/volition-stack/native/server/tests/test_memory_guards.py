"""Exercise memory guards without changing the host's systemd state."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SERVER = Path(__file__).resolve().parents[1]
SCRIPT = SERVER / 'memory-guards.sh'
INSTALL = SERVER / 'install.sh'
AUDIT = SERVER.parent / 'hardening/audit.sh'


class MemoryGuardsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        bin_dir = self.root / 'bin'
        bin_dir.mkdir()
        self.calls = self.root / 'calls'
        (bin_dir / 'id').write_text('''#!/bin/sh
if [ "$1" = -u ]; then
  case "$2" in developer) echo 2345 ;; wilhelmpa) echo 1234 ;; *) exit 1 ;; esac
  exit
fi
exec /usr/bin/id "$@"
''')
        (bin_dir / 'systemctl').write_text('''#!/bin/sh
if [ "$1" = show ]; then
  case "$*" in
    *--property=LoadState*)
      [ "$2" = "${FAKE_MISSING:-}" ] && echo not-found || echo loaded ;;
    *--property=MemoryLow*)
      if [ "${FAKE_MATCH:-0}" = 1 ]; then
        case "$2" in
          system.slice) echo 11811160064 ;;
          lemond.service) echo 7516192768 ;;
          postgresql@17-main.service) echo 1073741824 ;;
          *) echo 536870912 ;;
        esac
      else echo 0; fi ;;
    *--property=MemoryHigh*)
      [ "${FAKE_MATCH:-0}" = 1 ] && echo 12884901888 || echo infinity ;;
    *--property=MemoryMax*)
      [ "${FAKE_MATCH:-0}" = 1 ] && echo 16106127360 || echo infinity ;;
  esac
else
  echo "$*" >> "$FAKE_CALLS"
fi
''')
        for path in bin_dir.iterdir():
            path.chmod(0o755)
        self.env = {
            **os.environ,
            'PATH': f'{bin_dir}:{os.environ["PATH"]}',
            'FAKE_CALLS': str(self.calls),
            'HELENA_MEMORY_INSTALL_PATH': str(self.root / 'installed'),
        }

    def run_script(self, *args, **env):
        return subprocess.run(['bash', str(SCRIPT), *args], env={**self.env, **env},
                              capture_output=True, text=True, timeout=5)

    def test_dry_run_resolves_development_uid_and_changes_nothing(self):
        result = subprocess.run(['sh', str(INSTALL), '--dry-run', '--owner', 'developer',
                                 'memory-guards'], env=self.env, capture_output=True,
                                text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('user-2345.slice MemoryHigh=12G', result.stdout)
        self.assertIn('MemoryHigh=12G MemoryMax=15G', result.stdout)
        self.assertIn('lemond.service MemoryLow=7G', result.stdout)
        self.assertFalse(self.calls.exists())
        self.assertFalse((self.root / 'installed').exists())

    def test_matching_values_are_idempotent_and_auditable(self):
        result = self.run_script('--dry-run', 'apply', FAKE_MATCH='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('would set', result.stdout)
        self.assertEqual(self.run_script('check', FAKE_MATCH='1').stdout.strip(), 'memory guards match')

    def test_check_warns_on_drift_and_missing_unit(self):
        drift = self.run_script('check')
        self.assertEqual(drift.returncode, 1)
        self.assertIn('system.slice MemoryLow=0, expected 11G', drift.stdout)
        missing = self.run_script('--dry-run', 'apply', FAKE_MISSING='lemond.service')
        self.assertEqual(missing.returncode, 1)
        self.assertIn('cannot apply: lemond.service is not-found', missing.stderr)

    def test_invalid_value_fails_before_systemd_changes(self):
        result = self.run_script('--dry-run', 'apply', HELENA_MEMORY_SYSTEM_LOW='eleven')
        self.assertEqual(result.returncode, 2)
        self.assertIn('invalid memory value', result.stderr)
        self.assertFalse(self.calls.exists())

    def test_memory_values_can_be_overridden(self):
        result = self.run_script('--dry-run', 'apply', HELENA_MEMORY_SERVICE_LOW='768M')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('volition-plan-api.service MemoryLow=768M', result.stdout)
        self.assertIn('volition-hermes-runner.service MemoryLow=768M', result.stdout)

    def test_audit_warns_when_missing_or_mismatched(self):
        env = {**self.env, 'HELENA_AUDIT_ONLY': 'sys.memory_guards'}
        missing = subprocess.run(['bash', str(AUDIT)], env=env, capture_output=True, text=True)
        self.assertIn('sys.memory_guards\tsystem\tmedium\twarn', missing.stdout)
        helper = self.root / 'installed'
        helper.write_text('#!/bin/sh\necho "system.slice MemoryLow=0, expected 11G"\nexit 1\n')
        helper.chmod(0o755)
        mismatch = subprocess.run(['bash', str(AUDIT)], env=env, capture_output=True, text=True)
        self.assertIn('sys.memory_guards\tsystem\tmedium\twarn', mismatch.stdout)
        self.assertIn('system.slice MemoryLow=0', mismatch.stdout)
        helper.write_text('#!/bin/sh\necho "memory guards match"\n')
        passed = subprocess.run(['bash', str(AUDIT)], env=env, capture_output=True, text=True)
        self.assertIn('sys.memory_guards\tsystem\tmedium\tpass', passed.stdout)


if __name__ == '__main__':
    unittest.main()
