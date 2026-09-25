"""voice.sh in dry-run: the pinned sources and models, the units and the voice commands, checked
without touching a machine.

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
SCRIPT = HERE.parent / 'voice.sh'
CATALOG = HERE.parent / 'voice-models.tsv'
ROOT = tempfile.mkdtemp(prefix='helena-voice-test-')


def tearDownModule():
    shutil.rmtree(ROOT, ignore_errors=True)


def dry(*args: str) -> str:
    env = {**os.environ, 'HELENA_AI_TEST_ROOT': ROOT, 'HELENA_VOICE_UNIT_DIR': f'{ROOT}/units'}
    result = subprocess.run(['sh', str(SCRIPT), '--dry-run', *args], capture_output=True, text=True, env=env)
    if result.returncode != 0:
        raise AssertionError(f'voice.sh {args} failed:\n{result.stdout}\n{result.stderr}')
    return result.stdout


class VoiceScriptTest(unittest.TestCase):
    def test_install_pins_sources_and_models(self):
        out = dry('install')
        self.assertIn('ggml-org/whisper.cpp/archive/refs/tags/v1.8.4.tar.gz', out)
        self.assertIn('ServeurpersoCom/qwentts.cpp/archive/6a3e91283220197bad2ae1eb40ae1c1392bfd820.tar.gz', out)
        self.assertIn('ServeurpersoCom/ggml/archive/765bc96f9bb8d4c397c91c23b4e5c52a93fcf9b0.tar.gz', out)
        # Models by commit, never by branch.
        for url in re.findall(r'https://huggingface.co/\S+', out):
            self.assertRegex(url, r'/resolve/[0-9a-f]{40}/')
        self.assertIn('cstr/whisper-large-v3-turbo-german-ggml', out)
        self.assertIn('qwen-talker-0.6b-base-Q8_0.gguf', out)
        # The design model is not part of the install (its own OK).
        self.assertNotIn('voicedesign', out)

    def test_builds_for_this_gpu_on_helenas_rocm(self):
        out = dry('install')
        self.assertEqual(out.count('-DGGML_HIP=ON'), 2)
        self.assertEqual(out.count('-DAMDGPU_TARGETS=gfx1151'), 2)
        self.assertIn('rocm-10.0.0', out)
        self.assertNotIn('HSA_OVERRIDE_GFX_VERSION', out)
        # rocWMMA flash attention makes whisper.cpp transcribe garbage on gfx1151 (measured).
        self.assertNotIn('ROCWMMA', out)
        self.assertIn('--flash-attn', out)

    def test_units_listen_on_loopback_in_a_sandbox(self):
        out = dry('install')
        for port in ('13306', '13307'):
            self.assertIn(f'--host 127.0.0.1 --port {port}', out)
        self.assertIn('--language de', out)
        self.assertIn('--request-path /v1 --inference-path /audio/transcriptions', out)
        self.assertEqual(out.count('IPAddressAllow=localhost'), 2)
        self.assertEqual(out.count('ProtectSystem=strict'), 2)
        self.assertEqual(out.count('DevicePolicy=closed'), 2)
        self.assertIn('ExecStartPost=', out)
        self.assertNotIn('0.0.0.0', out)

    def test_catalog_rows_are_complete(self):
        for line in CATALOG.read_text().splitlines():
            if not line.strip() or line.startswith('#'):
                continue
            name, role, repo, commit, file, size, sha, license_, remote = line.split('\t')
            self.assertRegex(commit, r'^[0-9a-f]{40}$', name)
            self.assertRegex(sha, r'^[0-9a-f]{64}$', name)
            self.assertTrue(int(size) > 10_000_000, name)
            self.assertIn(license_, ('Apache-2.0', 'MIT'), name)

    def test_voice_design_and_names(self):
        out = dry('voice', 'design', 'helena', 'A warm female voice, calm')
        self.assertIn('qwen-talker-1.7b-voicedesign', out)
        self.assertIn('qwen-codec', out)
        self.assertIn('--lang German', out)
        env = {**os.environ, 'HELENA_AI_TEST_ROOT': ROOT}
        bad = subprocess.run(['sh', str(SCRIPT), '--dry-run', 'voice', 'design', 'Bad Name', 'x'],
                             capture_output=True, text=True, env=env)
        self.assertNotEqual(bad.returncode, 0)


if __name__ == '__main__':
    unittest.main()
