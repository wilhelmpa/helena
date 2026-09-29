"""embed.sh in dry-run and render mode: the embedding server's unit and what install would do.

    python3 -m unittest discover -s deployment/volition-stack/native/local-ai/tests
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / 'embed.sh'
CATALOG = HERE.parent / 'models.tsv'


def run(*args: str, root: str) -> subprocess.CompletedProcess:
    env = {**os.environ, 'HELENA_AI_TEST_ROOT': root}
    return subprocess.run(['sh', str(SCRIPT), *args], capture_output=True, text=True, env=env)


def catalog_line() -> list[str]:
    for line in CATALOG.read_text().splitlines():
        if line.startswith('Qwen3-Embedding-0.6B-GGUF\t'):
            return line.split('\t')
    raise AssertionError('no embedding model in models.tsv')


class EmbedScriptTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='helena-embed-test-')

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def place_model(self):
        name, _kind, _unit, repo, commit, file, size, _total, sha, *_ = catalog_line()
        folder = Path(self.root, 'var/lib/helena-ai/models/hub', 'models--' + repo.replace('/', '--'))
        blob = folder / 'blobs' / sha
        blob.parent.mkdir(parents=True)
        with open(blob, 'wb') as handle:
            handle.truncate(int(size))
        link = folder / 'snapshots' / commit / file
        link.parent.mkdir(parents=True)
        os.symlink(f'../../blobs/{sha}', link)

    def test_unit_serves_only_the_pinned_model_under_lemonades_name(self):
        result = run('render', root=self.root)
        self.assertEqual(result.returncode, 0, result.stderr)
        unit = result.stdout
        self.assertNotRegex(unit, r'@[A-Z]+@')
        _name, _k, _u, repo, commit, file, *_ = catalog_line()
        self.assertIn(
            f'--model /var/lib/helena-ai/models/hub/models--{repo.replace("/", "--")}/snapshots/{commit}/{file}',
            unit)
        self.assertIn('--alias Qwen3-Embedding-0.6B-GGUF', unit)
        self.assertIn('--embeddings', unit)
        self.assertIn('--host 127.0.0.1 --port 13308', unit)
        self.assertIn('--api-key-file %d/api-key', unit)
        self.assertIn('LoadCredential=api-key:/etc/helena/local-ai.key', unit)
        self.assertIn('/opt/helena-ai/llamacpp/vulkan-b11166/llama-server', unit)
        self.assertNotIn('DeviceAllow=/dev/kfd', unit)
        self.assertIn('IPAddressAllow=localhost', unit)
        # An embedding needs its whole input in one micro-batch: the per-slot context fits.
        ctx = int(re.search(r'--ctx-size (\d+)', unit).group(1))
        ubatch = int(re.search(r'--ubatch-size (\d+)', unit).group(1))
        slots = int(re.search(r'--parallel (\d+)', unit).group(1))
        self.assertGreaterEqual(ubatch, ctx // slots)

    def test_the_backend_can_be_vulkan(self):
        env = {**os.environ, 'HELENA_AI_TEST_ROOT': self.root, 'HELENA_EMBED_BACKEND': 'rocm'}
        unit = subprocess.run(['sh', str(SCRIPT), 'render'], capture_output=True, text=True, env=env).stdout
        self.assertIn('/opt/helena-ai/llamacpp/rocm-b11166/llama-server', unit)
        self.assertIn('DeviceAllow=/dev/kfd rw', unit)

    def test_install_names_a_missing_model_and_starts_the_unit(self):
        out = run('--dry-run', 'install', root=self.root).stdout
        self.assertIn('install.sh models pull Qwen3-Embedding-0.6B-GGUF', out)
        self.assertIn('would: systemctl restart helena-embed.service', out)
        self.place_model()
        out = run('--dry-run', 'install', root=self.root).stdout
        self.assertIn('have Qwen3-Embedding-0.6B-GGUF', out)

    def test_uninstall_keeps_the_model(self):
        out = run('--dry-run', 'uninstall', root=self.root).stdout
        self.assertIn('would: systemctl disable --now helena-embed.service', out)
        self.assertNotIn('rm -rf', out)

    def test_test_root_only_for_dry_runs(self):
        result = run('install', root=self.root)
        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
