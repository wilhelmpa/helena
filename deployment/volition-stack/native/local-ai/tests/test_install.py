"""install.sh in dry-run: what it would fetch, write and run, checked without touching a machine.

    python3 -m unittest discover -s deployment/volition-stack/native/local-ai/tests
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
CATALOG = HERE.parent / 'models.tsv'

# The installer's state (downloads, /opt/helena-ai, models, the key) in a temporary directory, so a
# dry run on a machine where local AI is installed reads that instead ("have …" otherwise).
ROOT = tempfile.mkdtemp(prefix='helena-ai-test-')
OPT = f'{ROOT}/opt/helena-ai'


def tearDownModule():
    shutil.rmtree(ROOT, ignore_errors=True)


def run(*args: str, root: str | None = ROOT) -> subprocess.CompletedProcess:
    env = {**os.environ, 'HELENA_AI_TEST_ROOT': root} if root else dict(os.environ)
    if not root:
        env.pop('HELENA_AI_TEST_ROOT', None)
    return subprocess.run(['sh', str(SCRIPT), *args], capture_output=True, text=True, env=env)


def dry(*args: str) -> str:
    result = run('--dry-run', *args)
    if result.returncode != 0:
        raise AssertionError(f'install.sh {args} failed:\n{result.stdout}\n{result.stderr}')
    return result.stdout


class InstallScriptTest(unittest.TestCase):
    def test_install_pins_every_download_and_package(self):
        out = dry('install')
        for url in (
            'lemonade-sdk/lemonade/releases/download/v2026.39.1/lemonade-server_2026.39.1-debian13_amd64.deb',
            'ggml-org/llama.cpp/releases/download/b11166/llama-b11166-bin-ubuntu-vulkan-x64.tar.gz',
            'ggml-org/llama.cpp/archive/refs/tags/b11166.tar.gz',
            'ROCm/FastFlowLM/releases/download/v1.0.6/fastflowlm_1.0.6_debian13_amd64.deb',
        ):
            self.assertIn(url, out)
        self.assertNotIn('llamacpp-rocm', out)
        self.assertIn('libxrt-npu2=1:2.25.0-4~bpo13+1', out)
        self.assertIn('libcpp-httplib0.41=0.41.0+ds-3~bpo13+1', out)
        self.assertIn('Pin-Priority: 1001', out)
        # The service is set up before the package can start it.
        self.assertLess(out.index('lemond.service.d/helena.conf'), out.index('apt-get install -y'))

    def test_rocm_is_one_hash_pinned_tree_and_llama_cpp_is_built_for_gfx1151(self):
        out = dry('install')
        self.assertIn(f'uv venv -q -p /usr/bin/python3.13 {OPT}/rocm-10.0.0', out)
        self.assertIn('--require-hashes --index-url https://stable.repo.amd.com/rocm/whl-next/', out)
        for flag in ('-DGGML_HIP=ON', '-DAMDGPU_TARGETS=gfx1151', '-DGGML_HIP_ROCWMMA_FATTN=ON',
                     '-DLLAMA_CURL=OFF', '-DCMAKE_BUILD_RPATH=$ORIGIN;'):
            self.assertIn(flag, out)
        self.assertIn(f'{OPT}/llamacpp/rocm-b11166', out)
        # gfx1151 is native in ROCm 10: no override of the GPU's identity anywhere.
        self.assertIsNone(re.search(r'HSA_OVERRIDE\w*=', SCRIPT.read_text()))
        requirements = (SCRIPT.parent / 'rocm-requirements.txt').read_text()
        for pin in ('rocm-sdk-device-gfx1151==10.0.0', 'torch==2.13.0+rocm10.0.0', 'rocm-sdk-devel==10.0.0'):
            self.assertIn(pin, requirements)
        # Every requirement carries at least one hash (pip refuses --require-hashes otherwise).
        blocks = re.split(r'\n(?=[a-z])', requirements)
        pinned = [b for b in blocks if re.match(r'^[a-z][\w.-]*==', b)]
        self.assertGreaterEqual(len(pinned), 20)
        for block in pinned:
            self.assertIn('--hash=sha256:', block, block.split()[0])

    def test_a_file_already_there_is_kept_not_fetched_again(self):
        # What made the dry run depend on the machine: an existing, checked download.
        downloads = Path(ROOT, 'var/cache/helena-ai/downloads')
        downloads.mkdir(parents=True, exist_ok=True)
        (downloads / 'llama.cpp-b11166.tar.gz').write_bytes(b'not the release')
        try:
            out = dry('install')
            # A file with the wrong checksum is fetched again, never used.
            self.assertIn('ggml-org/llama.cpp/archive/refs/tags/b11166.tar.gz', out)
        finally:
            (downloads / 'llama.cpp-b11166.tar.gz').unlink()

    def test_the_test_root_is_for_dry_runs_only(self):
        result = run('status')
        self.assertEqual(result.returncode, 2)
        self.assertIn('--dry-run only', result.stderr)

    def test_no_rocm_is_vulkan_only(self):
        out = dry('--no-rocm', 'install')
        self.assertNotIn('rocm-10.0.0', out)
        self.assertNotIn('GGML_HIP', out)
        self.assertIn('"backend": "vulkan"', out)

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
        self.assertEqual(config['llamacpp']['backend'], 'rocm')
        self.assertEqual(config['llamacpp']['rocm_bin'], f'{OPT}/llamacpp/rocm-b11166/llama-server')
        self.assertEqual(config['llamacpp']['vulkan_bin'], f'{OPT}/llamacpp/vulkan-b11166/llama-server')
        self.assertIn('--load-mode none', config['llamacpp']['args'])
        # Models answer without thinking unless a request asks (Lemonade keeps the single
        # quotes' content as one argument: valid JSON for llama-server).
        self.assertIn("--chat-template-kwargs '{\"enable_thinking\":false}'", config['llamacpp']['args'])
        self.assertTrue(config['flm']['prefer_system'])

    def test_no_npu_leaves_fastflowlm_and_xrt_out(self):
        out = dry('--no-npu', 'install')
        self.assertNotIn('fastflowlm', out)
        self.assertNotIn('libxrt', out)

    def test_a_model_in_a_folder_links_to_its_blob_and_registers(self):
        out = dry('models', 'pull', 'user.Mistral-Small-4-119B-GGUF')
        self.assertIn(
            'ln -sfn ../../../blobs/f51e11020a2f36c542f3bdfda4c7e127d8d2a865e85a982e0a9185fa60d7b8f7 '
            f'{ROOT}/var/lib/helena-ai/models/hub/models--unsloth--Mistral-Small-4-119B-2603-GGUF/snapshots/'
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

    def _pulled(self, *repos: str) -> None:
        for repo in repos:
            Path(ROOT, 'var/lib/helena-ai/models/hub', 'models--' + repo.replace('/', '--')).mkdir(
                parents=True, exist_ok=True)

    def test_the_models_in_use_load_when_lemonade_starts(self):
        out = dry('install')
        # The unit runs the installer's own copy with its catalog, never the checkout.
        self.assertIn('/install.sh /usr/local/lib/helena-ai/install.sh', out)
        self.assertIn('/models.tsv /usr/local/lib/helena-ai/models.tsv', out)
        self.assertIn('would write /etc/systemd/system/helena-ai-preload.service', out)
        self.assertIn('systemctl enable helena-ai-preload.service', out)
        # Enabled before Lemonade (re)starts, which pulls it in.
        self.assertLess(out.index('systemctl enable helena-ai-preload.service'),
                        out.index('systemctl restart lemond.service'))
        unit = (HERE.parent / 'systemd/helena-ai-preload.service').read_text()
        for line in ('ExecStart=/usr/local/lib/helena-ai/install.sh models preload run',
                     'After=lemond.service', 'PartOf=lemond.service', 'WantedBy=lemond.service',
                     'LoadCredential=api-key:/etc/helena/local-ai.key',
                     'Environment=HELENA_AI_KEY_FILE=%d/api-key', 'DynamicUser=yes',
                     'IPAddressDeny=any', 'IPAddressAllow=localhost', 'Type=oneshot'):
            self.assertIn(line, unit)

    def test_preload_set_keeps_to_the_vram_budget_and_the_gpu(self):
        self._pulled('unsloth/Qwen3.6-35B-A3B-MTP-GGUF', 'Qwen/Qwen3-Embedding-0.6B-GGUF',
                     'ggml-org/gpt-oss-120b-GGUF', 'unsloth/Mistral-Small-4-119B-2603-GGUF')
        out = dry('models', 'preload', 'set', 'Qwen3.6-35B-A3B-MTP-GGUF', 'Qwen3-Embedding-0.6B-GGUF')
        self.assertIn(f'would write {ROOT}/etc/helena/local-ai-preload (0644 root:root)', out)
        self.assertIn('    Qwen3.6-35B-A3B-MTP-GGUF\n    Qwen3-Embedding-0.6B-GGUF', out)
        self.assertIn('30.6 GB of 96.6 GB', out)
        # The workhorse and the heavy model do not both fit next to the embeddings.
        over = run('--dry-run', 'models', 'preload', 'set', 'Qwen3.6-35B-A3B-MTP-GGUF',
                   'gpt-oss-120b-mxfp-GGUF', 'Qwen3-Embedding-0.6B-GGUF')
        self.assertEqual(over.returncode, 1)
        self.assertIn('more than the 96.6 GB there is room for', over.stderr)
        npu = run('--dry-run', 'models', 'preload', 'set', 'whisper-v3-turbo-FLM')
        self.assertEqual(npu.returncode, 1)
        self.assertIn('loads on demand', npu.stderr)
        missing = run('--dry-run', 'models', 'preload', 'set', 'Qwen3-0.6B-GGUF')
        self.assertEqual(missing.returncode, 1)
        self.assertIn('is not pulled', missing.stderr)
        self.assertEqual(run('--dry-run', 'models', 'preload', 'set', 'No-Such-Model').returncode, 1)

    def test_preload_run_pins_what_fits_and_says_what_did_not(self):
        etc = Path(ROOT, 'etc/helena')
        etc.mkdir(parents=True, exist_ok=True)
        listed = etc / 'local-ai-preload'
        try:
            listed.write_text('# comment\nQwen3.6-35B-A3B-MTP-GGUF\nuser.Mistral-Small-4-119B-GGUF\n'
                              'Qwen3-Embedding-0.6B-GGUF\n')
            result = run('--dry-run', 'models', 'preload', 'run')
            out = result.stdout
            self.assertIn('"model_name":"Qwen3.6-35B-A3B-MTP-GGUF","ctx_size":131072,"save_options":true,'
                          '"pinned":true', out)
            self.assertIn('"model_name":"Qwen3-Embedding-0.6B-GGUF"', out)
            # 75 GB of Mistral does not fit next to the workhorse: skipped, and the unit fails.
            self.assertIn('user.Mistral-Small-4-119B-GGUF does not fit in VRAM', out)
            self.assertEqual(result.returncode, 1)
            listed.write_text('# No models are loaded at start\n')
            empty = run('--dry-run', 'models', 'preload', 'run')
            self.assertEqual(empty.returncode, 0)
            self.assertIn('no models to load at start', empty.stdout)
        finally:
            listed.unlink(missing_ok=True)

    def test_saved_model_options_are_used_by_one_load(self):
        options = Path(ROOT, 'var/lib/helena-ai/config/model-options.json')
        options.parent.mkdir(parents=True, exist_ok=True)
        options.write_text(json.dumps({'Qwen3.6-35B-A3B-MTP-GGUF': {
            'backend': 'vulkan', 'specType': 'draft-mtp', 'draftTokens': 2,
            'parallel': 2, 'contextPerSlot': 65536,
        }}))
        try:
            out = dry('models', 'load', 'Qwen3.6-35B-A3B-MTP-GGUF')
            body = json.loads(out.split('would POST /load ', 1)[1])
            self.assertEqual(body['llamacpp_backend'], 'vulkan')
            self.assertEqual(body['ctx_size'], 131072)
            self.assertIn('--spec-type draft-mtp --spec-draft-n-max 2 -np 2 --kv-unified-per-slot 65536', body['llamacpp_args'])
            other = json.loads(dry('models', 'load', 'Qwen3.6-35B-A3B-GGUF').split('would POST /load ', 1)[1])
            self.assertNotIn('--spec-type', other['llamacpp_args'])
            options.write_text(json.dumps({'Qwen3.8-27B-GGUF': {
                'specType': 'draft-dflash',
                'draftModel': '/var/lib/helena-ai/models/draft.gguf',
                'draftTokens': 4,
            }}))
            dflash = json.loads(dry('models', 'load', 'Qwen3.8-27B-GGUF').split('would POST /load ', 1)[1])
            self.assertIn('--spec-type draft-dflash --spec-draft-n-max 4 --spec-draft-model /var/lib/helena-ai/models/draft.gguf', dflash['llamacpp_args'])
            options.write_text(json.dumps({'Qwen3.6-35B-A3B-MTP-GGUF': {'specType': '; touch /tmp/x'}}))
            invalid = run('--dry-run', 'models', 'load', 'Qwen3.6-35B-A3B-MTP-GGUF')
            self.assertNotEqual(invalid.returncode, 0)
        finally:
            options.unlink(missing_ok=True)

    def test_a_manual_load_does_not_pin(self):
        out = dry('models', 'load', 'Qwen3.6-35B-A3B-MTP-GGUF')
        self.assertIn('"save_options":true', out)
        self.assertNotIn('pinned', out)

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
