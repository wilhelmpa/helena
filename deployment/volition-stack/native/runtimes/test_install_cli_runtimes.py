#!/usr/bin/env python3
"""Tests of install-cli-runtimes.sh against a release served from files: a fake Claude Code
binary with a manifest signed by a throwaway key, and a fake npm. Nothing is downloaded and
nothing outside a temporary directory is touched; no root needed.

    python3 deployment/volition-stack/native/runtimes/test_install_cli_runtimes.py
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / 'install-cli-runtimes.sh'
NODE = shutil.which('node') or '/usr/local/bin/node'

FAKE_NPM = """#!/usr/bin/env python3
import json, os, sys
# `npm ci`: lays out what the lockfile names, as npm would; `npm ls`: nothing is missing;
# `npm install --package-lock-only`: a lockfile for exactly what package.json names.
if sys.argv[1] == 'ls':
    sys.exit(0)
BINS = {'@openai/codex': {'codex': 'bin/codex.js'},
        '@agentclientprotocol/codex-acp': {'codex-acp': 'dist/index.js'}}
if sys.argv[1] == 'install':
    assert '--package-lock-only' in sys.argv and '--ignore-scripts' in sys.argv, sys.argv
    deps = json.load(open('package.json'))['dependencies']
    packages = {'': {'dependencies': deps}}
    for name, version in deps.items():
        packages['node_modules/' + name] = {
            'version': version, 'integrity': 'sha512-new',
            'resolved': 'https://registry.npmjs.org/%s/-/x-%s.tgz' % (name, version),
            'bin': BINS.get(name, {}),
        }
    json.dump({'lockfileVersion': 3, 'packages': packages}, open('package-lock.json', 'w'))
    sys.exit(0)
assert sys.argv[1] == 'ci' and '--ignore-scripts' in sys.argv, sys.argv
lock = json.load(open('package-lock.json'))
for path, entry in lock['packages'].items():
    if not path:
        continue
    os.makedirs(path, exist_ok=True)
    for name, target in (entry.get('bin') or {}).items():
        file = os.path.join(path, target)
        os.makedirs(os.path.dirname(file), exist_ok=True)
        with open(file, 'w') as handle:
            handle.write("#!/usr/bin/env node\\nconsole.log('codex-cli %s');\\n" % entry['version'])
open('npm-args', 'w').write(' '.join(sys.argv[1:]))
"""


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class InstallTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='helena-runtimes-test-',
                                          dir=os.environ.get('TMPDIR'))).resolve()
        self.gnupg = self.root / 'gnupg'
        self.gnupg.mkdir(mode=0o700)
        self.release = self.root / 'release'
        self.pins = self.root / 'pins'
        (self.pins / 'keys').mkdir(parents=True)
        self.prefix = self.root / 'opt'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.fingerprint = self.make_key()
        self.claude = self.publish_claude('2.1.281')
        self.write_npm_lock('codex', '0.156.1')
        self.write_npm_lock('codex-acp', '1.13.1', dependency='@agentclientprotocol/codex-acp',
                            binary=('codex-acp', 'dist/index.js'))
        self.fake_npm = self.root / 'npm'
        self.fake_npm.write_text(FAKE_NPM)
        self.fake_npm.chmod(0o755)
        self.write_pins('2.1.281')

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    # ── fixtures ──────────────────────────────────────────────────────────────────────

    def gpg(self, *args: str, input: str | None = None) -> str:
        return subprocess.run(['gpg', '--batch', '--quiet', '--homedir', str(self.gnupg), *args],
                              input=input, capture_output=True, text=True, check=True).stdout

    def make_key(self) -> str:
        self.gpg('--pinentry-mode', 'loopback', '--passphrase', '', '--quick-gen-key',
                 'Helena Test Release <test@helena.invalid>', 'ed25519', 'sign', '1d')
        fingerprint = next(line.split(':')[9] for line in
                           self.gpg('--with-colons', '--fingerprint').splitlines()
                           if line.startswith('fpr:'))
        (self.pins / 'keys' / 'release.asc').write_text(self.gpg('--armor', '--export', fingerprint))
        return fingerprint

    def publish_claude(self, version: str, sign: bool = True) -> Path:
        folder = self.release / version / 'linux-x64'
        folder.mkdir(parents=True)
        binary = folder / 'claude'
        binary.write_text(f'#!/bin/sh\necho "{version} (Claude Code)"\n')
        binary.chmod(0o755)
        for platform in ('linux-arm64',):
            (self.release / version / platform).mkdir()
            shutil.copy(binary, self.release / version / platform / 'claude')
        manifest = {
            'version': version,
            'platforms': {p: {'binary': 'claude', 'checksum': sha256(binary),
                              'size': binary.stat().st_size} for p in ('linux-x64', 'linux-arm64')},
        }
        path = self.release / version / 'manifest.json'
        path.write_text(json.dumps(manifest))
        if sign:
            self.gpg('--pinentry-mode', 'loopback', '--passphrase', '', '--detach-sign',
                     '--output', str(path) + '.sig', str(path))
        return binary

    def write_npm_lock(self, name: str, version: str, dependency: str = '@openai/codex',
                       binary: tuple[str, str] = ('codex', 'bin/codex.js')):
        folder = self.pins / 'npm' / name
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'package.json').write_text(json.dumps({'dependencies': {dependency: version}}))
        (folder / 'package-lock.json').write_text(json.dumps({
            'lockfileVersion': 3,
            'packages': {
                '': {'dependencies': {dependency: version}},
                f'node_modules/{dependency}': {
                    'version': version,
                    'resolved': f'https://registry.npmjs.org/{dependency}/-/x-{version}.tgz',
                    'integrity': 'sha512-test',
                    'bin': {binary[0]: binary[1]},
                },
            },
        }))

    def write_pins(self, claude_version: str):
        binary = self.release / claude_version / 'linux-x64' / 'claude'
        arm = self.release / claude_version / 'linux-arm64' / 'claude'
        pins = {
            'schemaVersion': 1,
            'prefix': '/opt/helena/runtimes',
            'bin': '/usr/local/bin',
            'runtimes': {
                'claude': {
                    'version': claude_version,
                    'source': 'claude-release',
                    'url': self.release.as_uri(),
                    'signingKey': 'keys/release.asc',
                    'signingKeyFingerprint': self.fingerprint,
                    'platforms': {
                        'linux-x64': {'sha256': sha256(binary), 'size': binary.stat().st_size},
                        'linux-arm64': {'sha256': sha256(arm), 'size': arm.stat().st_size},
                    },
                    'links': {'claude': 'claude'},
                },
                'codex': {
                    'version': '0.156.1', 'source': 'npm', 'lock': 'npm/codex', 'omitOptional': False,
                    'links': {'codex': 'node_modules/@openai/codex/bin/codex.js'},
                },
                'codex-acp': {
                    'version': '1.13.1', 'source': 'npm', 'lock': 'npm/codex-acp',
                    'omitOptional': True, 'acp': True,
                    'links': {'codex-acp': 'node_modules/@agentclientprotocol/codex-acp/dist/index.js'},
                },
            },
        }
        (self.pins / 'runtimes.json').write_text(json.dumps(pins))
        # The script reads its lockfiles and keys next to the pins it is given.
        for item in ('install-cli-runtimes.sh',):
            shutil.copy(SCRIPT, self.pins / item)

    def run_script(self, *args: str, check: bool = True) -> subprocess.CompletedProcess:
        env = {
            'PATH': f'{os.path.dirname(NODE)}:/usr/bin:/bin',
            'HOME': str(self.root),
            'TMPDIR': str(self.root),
            'HELENA_RUNTIME_TESTING': '1',
            'HELENA_RUNTIME_PINS': str(self.pins / 'runtimes.json'),
            'HELENA_RUNTIME_PREFIX': str(self.prefix),
            'HELENA_RUNTIME_BIN': str(self.bin),
            'HELENA_RUNTIME_STATE': str(self.root / 'state'),
            'NPM': str(self.fake_npm),
            'NODE': NODE,
        }
        result = subprocess.run(['bash', str(self.pins / 'install-cli-runtimes.sh'), *args],
                                env=env, capture_output=True, text=True)
        if check and result.returncode != 0:
            self.fail(f'{args} failed: {result.stdout}{result.stderr}')
        return result

    # ── tests ─────────────────────────────────────────────────────────────────────────

    def test_installs_every_runtime_pinned_and_links_it(self):
        out = self.run_script('install').stdout
        self.assertIn('claude 2.1.281 installed', out)
        self.assertIn('codex 0.156.1 installed', out)
        self.assertIn('codex-acp 1.13.1 installed', out)
        claude = self.bin / 'claude'
        self.assertEqual(os.readlink(claude), str(self.prefix / 'claude/current/claude'))
        self.assertEqual(subprocess.run([str(claude)], capture_output=True, text=True).stdout.strip(),
                         '2.1.281 (Claude Code)')
        self.assertEqual(os.readlink(self.prefix / 'claude/current'), '2.1.281')
        codex = subprocess.run([str(self.bin / 'codex')], capture_output=True, text=True,
                               env={'PATH': f'{os.path.dirname(NODE)}:/usr/bin:/bin'})
        self.assertEqual(codex.stdout.strip(), 'codex-cli 0.156.1')
        # npm ran without scripts; the adapter without its optional platform binaries.
        self.assertIn('--ignore-scripts', (self.prefix / 'codex/0.156.1/npm-args').read_text())
        self.assertIn('--omit=optional', (self.prefix / 'codex-acp/1.13.1/npm-args').read_text())
        self.assertNotIn('--omit=optional', (self.prefix / 'codex/0.156.1/npm-args').read_text())
        # Nothing is writable by others, and no staging is left behind.
        self.assertEqual((self.prefix / 'claude/2.1.281').stat().st_mode & 0o022, 0)
        self.assertFalse((self.prefix / '.staging').exists())

    def test_a_second_run_downloads_nothing(self):
        self.run_script('install')
        shutil.rmtree(self.release / '2.1.281')
        out = self.run_script('install').stdout
        self.assertIn('claude 2.1.281 is installed', out)
        self.assertIn('codex 0.156.1 is installed', out)

    def test_without_acp_leaves_the_adapters_out(self):
        self.run_script('install', '--without-acp')
        self.assertFalse((self.bin / 'codex-acp').exists())
        self.assertTrue((self.bin / 'codex').exists())
        self.run_script('install', '--only', 'codex-acp')
        self.assertTrue((self.bin / 'codex-acp').exists())

    def test_refuses_a_binary_that_does_not_match_its_pin(self):
        binary = self.release / '2.1.281' / 'linux-x64' / 'claude'
        binary.write_text('#!/bin/sh\necho evil\n')
        result = self.run_script('install', '--only', 'claude', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('wrong', result.stderr)
        self.assertFalse((self.bin / 'claude').exists())
        self.assertFalse(any((self.prefix / '.staging').glob('*')))

    def test_refuses_a_manifest_the_pinned_key_did_not_sign(self):
        (self.release / '2.1.281' / 'manifest.json').write_text(
            (self.release / '2.1.281' / 'manifest.json').read_text().replace('2.1.281', '2.1.281 '))
        result = self.run_script('install', '--only', 'claude', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('not signed with the pinned release key', result.stderr)

    def test_refuses_a_signed_manifest_that_disagrees_with_the_pin(self):
        pins = json.loads((self.pins / 'runtimes.json').read_text())
        pins['runtimes']['claude']['platforms']['linux-x64']['sha256'] = 'a' * 64
        (self.pins / 'runtimes.json').write_text(json.dumps(pins))
        result = self.run_script('install', '--only', 'claude', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('disagree', result.stderr)

    def test_status_verify_and_rollback(self):
        self.run_script('install')
        status = json.loads(self.run_script('status', '--json').stdout)
        self.assertEqual(status['claude'], {'pinned': '2.1.281', 'current': '2.1.281',
                                            'previous': None, 'intact': True})
        self.run_script('verify')

        # A newer pin: installed next to the old one, which stays for rollback.
        self.publish_claude('2.1.290')
        self.write_pins('2.1.290')
        self.run_script('install', '--only', 'claude')
        status = json.loads(self.run_script('status', '--json').stdout)
        self.assertEqual(status['claude']['current'], '2.1.290')
        self.assertEqual(status['claude']['previous'], '2.1.281')
        out = self.run_script('rollback', 'claude').stdout
        self.assertIn('back on 2.1.281', out)
        self.assertEqual(subprocess.run([str(self.bin / 'claude')], capture_output=True,
                                        text=True).stdout.strip(), '2.1.281 (Claude Code)')

        # A changed binary is found.
        (self.prefix / 'claude/2.1.281/claude').write_text('#!/bin/sh\necho changed\n')
        self.assertNotEqual(self.run_script('verify', check=False).returncode, 0)

    def test_upgrade_takes_the_pin_from_the_signed_manifest(self):
        self.run_script('install', '--only', 'claude')
        self.publish_claude('2.1.290')
        out = self.run_script('upgrade', 'claude', '2.1.290').stdout
        self.assertIn('claude upgraded from 2.1.281 to 2.1.290', out)
        status = json.loads(self.run_script('status', '--json').stdout)
        self.assertEqual(status['claude'], {'pinned': '2.1.290', 'current': '2.1.290',
                                            'previous': '2.1.281', 'intact': True})
        kept = json.loads((self.root / 'state' / 'pins.json').read_text())
        self.assertEqual(kept['runtimes']['claude']['version'], '2.1.290')
        self.assertEqual(subprocess.run([str(self.bin / 'claude')], capture_output=True,
                                        text=True).stdout.strip(), '2.1.290 (Claude Code)')
        # Another install keeps the upgraded version; a newer pin in the repository wins.
        self.assertIn('claude 2.1.290 is installed', self.run_script('install', '--only', 'claude').stdout)
        self.publish_claude('2.1.300')
        self.write_pins('2.1.300')
        self.assertIn('claude 2.1.300 installed', self.run_script('install', '--only', 'claude').stdout)

    def test_upgrade_refuses_an_unsigned_manifest_and_keeps_everything(self):
        self.run_script('install', '--only', 'claude')
        self.publish_claude('2.1.291', sign=False)
        result = self.run_script('upgrade', 'claude', '2.1.291', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('not signed with the pinned release key', result.stderr)
        self.assertEqual(os.readlink(self.prefix / 'claude/current'), '2.1.281')
        self.assertFalse((self.root / 'state' / 'pins.json').exists())

    def test_upgrade_of_an_npm_runtime_resolves_a_new_lockfile(self):
        self.run_script('install', '--only', 'codex')
        out = self.run_script('upgrade', 'codex', '0.158.0').stdout
        self.assertIn('codex upgraded from 0.156.1 to 0.158.0', out)
        codex = subprocess.run([str(self.bin / 'codex')], capture_output=True, text=True,
                               env={'PATH': f'{os.path.dirname(NODE)}:/usr/bin:/bin'})
        self.assertEqual(codex.stdout.strip(), 'codex-cli 0.158.0')
        lock = self.root / 'state' / 'npm' / 'codex' / '0.158.0' / 'package-lock.json'
        self.assertTrue(lock.exists())
        self.assertIn('--ignore-scripts', (self.prefix / 'codex/0.158.0/npm-args').read_text())
        status = json.loads(self.run_script('status', '--json').stdout)
        self.assertEqual(status['codex']['previous'], '0.156.1')
        self.assertTrue(status['codex']['intact'])
        self.run_script('rollback', 'codex')
        self.assertEqual(os.readlink(self.prefix / 'codex/current'), '0.156.1')

    def test_upgrade_refuses_what_is_not_newer_or_not_a_version(self):
        self.run_script('install', '--only', 'codex')
        older = self.run_script('upgrade', 'codex', '0.100.0', check=False)
        self.assertNotEqual(older.returncode, 0)
        self.assertIn('not newer', older.stderr)
        bad = self.run_script('upgrade', 'codex', '1.0; rm -rf /', check=False)
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn('is not a version', bad.stderr)
        unknown = self.run_script('upgrade', 'evil', '1.0.0', check=False)
        self.assertIn('unknown runtime', unknown.stderr)

    def test_plan_names_every_download(self):
        out = self.run_script('plan').stdout
        self.assertIn('/2.1.281/linux-x64/claude', out)
        self.assertIn(self.fingerprint, out)
        self.assertIn('codex 0.156.1: npm registry, 1 packages pinned by sha512', out)

    def test_dry_run_changes_nothing(self):
        out = self.run_script('install', '--dry-run').stdout
        self.assertIn('would download', out)
        self.assertFalse((self.bin / 'claude').exists())
        self.assertFalse(self.prefix.exists() and any(self.prefix.iterdir()))


if __name__ == '__main__':
    unittest.main()
