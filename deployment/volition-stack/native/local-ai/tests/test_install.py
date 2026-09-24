"""install.sh in dry-run: what it would fetch, write and run, checked without touching a machine.

    python3 -m unittest discover -s deployment/volition-stack/native/local-ai/tests
"""

import json
import re
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / 'install.sh'
CATALOG = HERE.parent / 'models.tsv'


def dry(*args: str) -> str:
    result = subprocess.run(['sh', str(SCRIPT), '--dry-run', *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise AssertionError(f'install.sh {args} failed:\n{result.stdout}\n{result.stderr}')
    return result.stdout


class InstallScriptTest(unittest.TestCase):
    def test_install_pins_every_download_and_package(self):
        out = dry('--rocm-backend', 'install')
        for url in (
            'lemonade-sdk/lemonade/releases/download/v2026.39.1/lemonade-server_2026.39.1-debian13_amd64.deb',
            'ggml-org/llama.cpp/releases/download/b10825/llama-b10825-bin-ubuntu-vulkan-x64.tar.gz',
            'ROCm/FastFlowLM/releases/download/v1.0.6/fastflowlm_1.0.6_debian13_amd64.deb',
            'lemonade-sdk/llamacpp-rocm/releases/download/b1324/llama-b1324-ubuntu-rocm-gfx1151-x64.zip',
        ):
            self.assertIn(url, out)
        self.assertIn('libxrt-npu2=1:2.25.0-4~bpo13+1', out)
        self.assertIn('libcpp-httplib0.41=0.41.0+ds-3~bpo13+1', out)
        self.assertIn('Pin-Priority: 1001', out)
        # The service is set up before the package can start it.
        self.assertLess(out.index('lemond.service.d/helena.conf'), out.index('apt-get install -y'))

    def test_lemonade_defaults_keep_it_local_and_offline(self):
        out = dry('install')
        block = out[out.index('lemonade-defaults.json'):]
        text = block[block.index('{'):block.index('\n    }\n') + 6]
        config = json.loads(re.sub(r'^    ', '', text, flags=re.M))
        self.assertEqual(config['host'], '127.0.0.1')
        self.assertTrue(config['offline'])
        self.assertTrue(config['no_fetch_executables'])
        self.assertFalse(config['broadcast'])
        self.assertFalse(config['telemetry']['enabled'])
        self.assertEqual(config['llamacpp']['vulkan_bin'], '/opt/helena-ai/llamacpp/vulkan-b10825')
        self.assertIn('--no-mmap', config['llamacpp']['args'])
        self.assertTrue(config['flm']['prefer_system'])

    def test_no_npu_leaves_fastflowlm_and_xrt_out(self):
        out = dry('--no-npu', 'install')
        self.assertNotIn('fastflowlm', out)
        self.assertNotIn('libxrt', out)

    def test_a_model_in_a_folder_links_to_its_blob_and_registers(self):
        out = dry('models', 'pull', 'user.Mistral-Small-4-119B-GGUF')
        self.assertIn(
            'ln -sfn ../../../blobs/f51e11020a2f36c542f3bdfda4c7e127d8d2a865e85a982e0a9185fa60d7b8f7 '
            '/var/lib/helena-ai/models/hub/models--unsloth--Mistral-Small-4-119B-2603-GGUF/snapshots/'
            'bd93c721735aa32c035c0f19e738cb3371fd56ff/UD-Q4_K_XL/'
            'Mistral-Small-4-119B-2603-UD-Q4_K_XL-00002-of-00003.gguf', out)
        self.assertIn('resolve/bd93c721735aa32c035c0f19e738cb3371fd56ff/mmproj-F16.gguf', out)
        self.assertIn('"checkpoint":"unsloth/Mistral-Small-4-119B-2603-GGUF:UD-Q4_K_XL"', out)
        self.assertIn('"mmproj":"mmproj-F16.gguf"', out)

    def test_a_registry_model_is_placed_by_commit(self):
        out = dry('models', 'pull', 'Qwen3-0.6B-GGUF')
        self.assertIn('https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/'
                      '50968a4468ef4233ed78cd7c3de230dd1d61a56b/Qwen3-0.6B-Q4_0.gguf', out)
        self.assertIn('ln -sfn ../../blobs/33bcc57074ec7b6eada5a90651ee546ec0c2b271002c22baf9f1b2dd1e8f75cb', out)
        self.assertNotIn('/pull', out)

    def test_the_catalog_is_complete_and_consistent(self):
        for line in CATALOG.read_text().splitlines():
            if line.startswith('#') or not line.strip():
                continue
            fields = line.split('\t')
            self.assertEqual(len(fields), 12, line[:60])
            name, kind, unit, repo, commit, files, sizes, total, sums = fields[:9]
            self.assertIn(kind, ('gguf', 'flm'))
            self.assertIn(unit, ('gpu', 'npu', 'cpu'))
            self.assertRegex(commit, r'^[0-9a-f]{40}$')
            if kind == 'gguf':
                n = len(files.split(','))
                self.assertEqual(len(sizes.split(',')), n, name)
                self.assertEqual(len(sums.split(',')), n, name)
                self.assertEqual(sum(int(s) for s in sizes.split(',')), int(total), name)
            for digest in sums.split(','):
                self.assertRegex(digest, r'^[0-9a-f]{64}$')


if __name__ == '__main__':
    unittest.main()
