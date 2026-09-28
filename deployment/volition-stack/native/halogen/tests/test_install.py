"""native/halogen/install.sh in dry-run and render mode: what it would fetch, write and run,
checked without touching a machine (no podman, no nft, no systemd).

    python3 -m unittest discover -s deployment/volition-stack/native/halogen/tests
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / 'install.sh'
FILES = HERE.parent / 'files.tsv'

IMAGE = (
    'ghcr.io/peonist-ai/halogen-flash-server@'
    'sha256:f3f99aa48f3a051f18da9ee24b333ca108fe745773fd036a365fe1875871d0be'
)
WEIGHTS_REPO_DIR = 'models--unsloth--Qwen3.8-Flash-Next-GGUF'
WEIGHTS_REVISION = '38bb39ee97821de2c9009abb7e93950eec396e66'


def run(*args: str, root: str | None, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    full = dict(os.environ)
    full.pop('HELENA_HALOGEN_TEST_ROOT', None)
    if root:
        full['HELENA_HALOGEN_TEST_ROOT'] = root
    full.update(env or {})
    return subprocess.run(['sh', str(SCRIPT), *args], capture_output=True, text=True, env=full)


def rows() -> list[list[str]]:
    return [
        line.split('\t')
        for line in FILES.read_text().splitlines()
        if line.strip() and not line.startswith('#')
    ]


class HalogenInstallTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='helena-halogen-test-')

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def dry(self, *args: str) -> str:
        result = run('--dry-run', *args, root=self.root)
        if result.returncode != 0:
            raise AssertionError(f'install.sh {args} failed:\n{result.stdout}\n{result.stderr}')
        return result.stdout

    def render(self, what: str) -> str:
        result = run('render', what, root=self.root)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def place_weights(self, sizes: dict[str, int] | None = None) -> None:
        for kind, repo, revision, path, size, sha in rows():
            if kind != 'weights':
                continue
            folder = Path(self.root, 'var/lib/helena-ai/models/hub', 'models--' + repo.replace('/', '--'))
            blob = folder / 'blobs' / sha
            blob.parent.mkdir(parents=True, exist_ok=True)
            with open(blob, 'wb') as handle:
                handle.truncate((sizes or {}).get(path, int(size)))
            link = folder / 'snapshots' / revision / path
            link.parent.mkdir(parents=True, exist_ok=True)
            depth = '../' * (path.count('/'))
            os.symlink(f'../../{depth}blobs/{sha}', link)

    # ── files.tsv ─────────────────────────────────────────────────────────────────────────

    def test_every_file_is_pinned_to_a_revision_and_a_sha256(self):
        kinds = set()
        for row in rows():
            self.assertEqual(len(row), 6, row)
            kind, repo, revision, path, size, sha = row
            kinds.add(kind)
            self.assertIn(kind, {'head', 'tokenizer', 'weights'})
            self.assertRegex(repo, r'^[\w.-]+/[\w.-]+$')
            self.assertRegex(revision, r'^[0-9a-f]{40}$')
            self.assertRegex(sha, r'^[0-9a-f]{64}$')
            self.assertGreater(int(size), 0)
            self.assertNotIn('..', path)
        self.assertEqual(kinds, {'head', 'tokenizer', 'weights'})
        # The tokenizer Helena's decisions read token ids from.
        self.assertIn('tokenizer/vocab.json', [row[3] for row in rows()])

    # ── the unit ──────────────────────────────────────────────────────────────────────────

    def test_unit_pins_the_image_and_binds_the_loopback_only(self):
        unit = self.render('unit')
        self.assertNotIn('@', unit.replace(IMAGE, '').replace('helena-halogen-proxy@', ''))
        self.assertIn(f'Environment=HALOGEN_IMAGE={IMAGE}', unit)
        self.assertIn('--pull=never', unit)
        # Every published port is on 127.0.0.1, never on all addresses.
        published = re.findall(r'-p (\S+)', unit)
        self.assertEqual(len(published), 2)
        for mapping in published:
            self.assertTrue(mapping.startswith('127.0.0.1:'), mapping)
        self.assertIn('--network helena-halogen', unit)
        # No download at start: the container opens no connection of its own.
        self.assertNotIn('HALOGEN_DOWNLOAD', unit)
        self.assertIn('ExecStartPre=/usr/sbin/nft list table inet helena_halogen', unit)

    def test_unit_starts_at_boot_restarts_and_stops_cleanly(self):
        unit = self.render('unit')
        self.assertIn('WantedBy=multi-user.target', unit)
        self.assertIn('Restart=on-failure', unit)
        self.assertIn('ExecStop=/usr/bin/podman stop -t 60 halogen', unit)
        stop = int(re.search(r'TimeoutStopSec=(\d+)', unit).group(1))
        self.assertGreater(stop, 60)
        self.assertIn('ExecStartPost=/usr/local/lib/helena-halogen/wait-healthy', unit)
        self.assertIn('--cgroups=split', unit)
        self.assertIn('Delegate=yes', unit)

    def test_unit_bounds_idle_cpu_and_keeps_one_info_log(self):
        unit = self.render('unit')
        self.assertIn('CPUQuota=100%', unit)
        self.assertIn('--log-driver=none', unit)
        self.assertIn('StandardError=inherit', unit)
        self.assertIn('SyslogLevel=info', unit)
        self.assertIn('LogFilterPatterns=~.*(GET|HEAD) /(metrics|v1/models)', unit)

    def test_unit_reads_the_pinned_weights_head_and_tokenizer(self):
        unit = self.render('unit')
        self.assertIn(
            f'-v /var/lib/helena-ai/models/hub/{WEIGHTS_REPO_DIR}:/gguf:ro', unit)
        self.assertIn(
            f'HALOGEN_CHECKPOINT=/gguf/snapshots/{WEIGHTS_REVISION}/UD-IQ4_XS/'
            'Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf', unit)
        self.assertIn('HALOGEN_MTP_HEAD=/models/qwen38-flash-next-mtp.hgn', unit)
        self.assertIn('HALOGEN_TOKENIZER=/models/tokenizer', unit)
        self.assertIn('-v /var/lib/helena-halogen/models:/models:ro', unit)
        self.assertIn('EnvironmentFile=/etc/helena/halogen.conf', unit)

    def test_settings_keep_what_ran_live(self):
        conf = (HERE.parent / 'halogen.conf').read_text()
        self.assertIn('HALOGEN_KV_SLOTS=2', conf)
        self.assertIn('HALOGEN_KV_POOL_POSITIONS=262144', conf)
        self.assertIn('HALOGEN_MAX_TOK=16384', conf)
        # Every setting the file names reaches the container.
        unit = self.render('unit')
        for name in re.findall(r'^#?(HALOGEN_[A-Z_]+)=', conf, re.M):
            self.assertIn(f'-e {name}', unit)

    # ── the firewall ──────────────────────────────────────────────────────────────────────

    def test_firewall_drops_what_the_container_starts_and_guards_the_ports(self):
        nft = self.render('nft')
        self.assertNotIn('@', nft.replace('@halogen_ports', '').replace('@halogen_uids', ''))
        self.assertIn('10.89.73.0/29 ct state new counter drop', nft)
        self.assertEqual(nft.count('ct state new counter drop'), 2)
        self.assertIn('elements = { 8731, 8733 }', nft)
        uids = re.search(r'set halogen_uids \{[^}]*elements = \{ ([^}]*) \}', nft, re.S).group(1)
        self.assertTrue(uids.startswith('0'), uids)
        # Before netavark's DNAT, so the loopback address is still the destination.
        self.assertIn('type filter hook output priority -150', nft)
        self.assertTrue(nft.index('table inet helena_halogen') < nft.index('delete table'))

    def test_firewall_names_only_existing_users(self):
        result = run('render', 'nft', root=self.root,
                     env={'HELENA_HALOGEN_USERS': 'root no-such-user-helena'})
        uids = re.search(r'elements = \{ ([0-9, ]+) \}', result.stdout.split('halogen_uids')[1]).group(1)
        expected = ['0']
        forwarder = subprocess.run(['id', '-u', 'helena-halogen-fwd'], capture_output=True, text=True)
        if forwarder.returncode == 0:
            expected.append(forwarder.stdout.strip())
        self.assertEqual([u.strip() for u in uids.split(',')], expected)

    # ── install ───────────────────────────────────────────────────────────────────────────

    def test_install_fetches_pinned_files_and_pulls_by_digest(self):
        self.place_weights()
        out = self.dry('install')
        self.assertIn(f'would: podman pull {IMAGE}', out)
        for kind, repo, revision, path, *_ in rows():
            url = f'https://huggingface.co/{repo}/resolve/{revision}/{path}'
            if kind == 'weights':
                self.assertNotIn(url, out)
            else:
                self.assertIn(url, out)
        self.assertIn('podman network create --disable-dns --subnet 10.89.73.0/29', out)
        self.assertIn('would: nft -f', out)
        self.assertIn('would: systemctl enable helena-halogen.service', out)
        self.assertIn('would write ' + self.root + '/etc/helena/halogen.conf', out)
        # The network and the firewall come before the unit that needs them.
        self.assertLess(out.index('nft -f'), out.index('helena-halogen.service (0644'))

    def test_install_keeps_existing_settings(self):
        self.place_weights()
        conf = Path(self.root, 'etc/helena/halogen.conf')
        conf.parent.mkdir(parents=True)
        conf.write_text('HALOGEN_KV_SLOTS=4\n')
        out = self.dry('install')
        self.assertIn(f'have {conf}', out)
        self.assertNotIn(f'would write {conf}', out)

    def test_weights_check_names_what_is_missing(self):
        result = run('weights', 'check', root=self.root)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout.count('MISSING'), 3)
        self.place_weights()
        result = run('weights', 'check', root=self.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(result.stdout.count('ok '), 3)

    def test_weights_check_refuses_a_shard_of_the_wrong_size(self):
        path = 'UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf'
        self.place_weights({path: 123})
        result = run('weights', 'check', root=self.root)
        self.assertEqual(result.returncode, 1)
        self.assertIn(f'MISSING {path}', result.stdout)

    def test_weights_pull_downloads_only_missing_shards_at_the_pinned_revision(self):
        out = self.dry('weights', 'pull')
        self.assertEqual(out.count('curl -fL'), 3)
        self.assertIn(f'resolve/{WEIGHTS_REVISION}/UD-IQ4_XS/', out)

    def test_cache_status_compares_the_shards(self):
        self.place_weights()
        cache = Path(self.root, 'var/lib/helena-halogen/cache')
        cache.mkdir(parents=True)
        shards = [
            {'name': row[3].split('/')[-1], 'size': int(row[4])}
            for row in rows() if row[0] == 'weights'
        ]
        meta = cache / 'Qwen3.8-Flash-Next-UD-IQ4_XS.hgn.json'
        meta.write_text(json.dumps({'shards': shards}))
        out = run('cache', 'status', root=self.root).stdout
        self.assertIn('current (3 shards)', out)
        shards[1]['size'] += 1
        meta.write_text(json.dumps({'shards': shards}))
        out = run('cache', 'status', root=self.root).stdout
        self.assertIn('stale (shard size changed', out)

    def test_uninstall_keeps_data_without_purge(self):
        out = self.dry('uninstall')
        self.assertIn('would: nft delete table inet helena_halogen', out)
        self.assertNotIn('rm -rf ' + self.root + '/var/lib/helena-halogen/cache', out)
        out = self.dry('--purge', 'uninstall')
        self.assertIn(f'podman rmi {IMAGE}', out)

    def test_test_root_is_for_dry_runs_only(self):
        result = run('install', root=self.root)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(Path(self.root).iterdir()), [])


class ProxyUnitsTest(unittest.TestCase):
    def test_forwarder_is_a_named_user_on_the_loopback(self):
        service = (HERE.parent / 'systemd/helena-halogen-proxy@.service').read_text()
        socket = (HERE.parent / 'systemd/helena-halogen-proxy@.socket').read_text()
        self.assertIn('systemd-socket-proxyd --exit-idle-time=10min 127.0.0.1:%i', service)
        self.assertIn('User=helena-halogen-fwd', service)
        self.assertNotIn('DynamicUser', service)
        self.assertIn('ListenStream=/run/volition-agents/helena-halogen-%i.sock', socket)
        self.assertIn('SocketGroup=volition-agents', socket)
        self.assertIn('SocketMode=0660', socket)


if __name__ == '__main__':
    unittest.main()
