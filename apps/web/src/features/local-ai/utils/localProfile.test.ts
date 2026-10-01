import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GlobalModelStatus } from '@/lib/api/endpoints/globalModel';
import type { ModelServer } from '@/lib/api/endpoints/localAi';
import {
  currentProfile,
  groupLocalModels,
  isNpuChatModel,
  isNpuModel,
  npuModelKey,
  npuModelName,
  pendingOperation,
  profileModelId,
  switchRequest,
} from './localProfile';
import { switchErrorKey } from './switchErrors';

const server = (slug: string, kind: string): ModelServer => ({ slug, kind }) as ModelServer;
const status = (maintenance: GlobalModelStatus['maintenance'], model: string | null = null) =>
  ({ model, maintenance, job: null }) as GlobalModelStatus;

test('NPU models are told apart by their server, and only the four chat models are NPU choices', () => {
  assert.equal(isNpuModel('helena-volition-npu/gemma4-it:e2b'), true);
  assert.equal(isNpuModel('helena-local/Qwen3.8-27B-GGUF'), false);
  assert.equal(isNpuModel('volition-local-default'), false);
  assert.equal(isNpuModel(null), false);
  assert.equal(isNpuChatModel('qwen3.5:4b'), true);
  assert.equal(isNpuChatModel('embed-gemma:300m'), false);
  assert.equal(npuModelName('gemma4-it:e4b'), 'Gemma 4 E4B');
  assert.equal(npuModelName('whisper-v3'), 'whisper-v3');
  assert.equal(npuModelKey('qwen3.5:2b'), 'qwen2b');
  assert.deepEqual(
    groupLocalModels([
      { id: 'helena-halogen/flash' },
      { id: 'helena-volition-npu/qwen3.5:2b' },
      { id: 'helena-local/Qwen3.8-27B-GGUF' },
    ]),
    {
      gpu: [{ id: 'helena-halogen/flash' }, { id: 'helena-local/Qwen3.8-27B-GGUF' }],
      npu: [{ id: 'helena-volition-npu/qwen3.5:2b' }],
    },
  );
});

test('a profile switch asks for the model id the server resolves', () => {
  const halogen = server('halogen', 'halogen');
  assert.equal(
    profileModelId('local-halogen', [halogen]),
    'helena-halogen/halogen-qwen3.8-flash-next',
  );
  assert.equal(profileModelId('local-halogen', []), null);
  // The 27B: a registered Lemonade server, else the default slug, else the one the switch adds.
  assert.equal(
    profileModelId('local-27b-npu', [server('lemon', 'lemonade')]),
    'helena-lemon/Qwen3.8-27B-GGUF',
  );
  assert.equal(profileModelId('local-27b-npu', []), 'helena-local/Qwen3.8-27B-GGUF');
  assert.equal(
    profileModelId('local-27b-npu', [server('local', 'embedding')]),
    'helena-volition-lemonade/Qwen3.8-27B-GGUF',
  );
});

test('the NPU model only goes along with the paired profile', () => {
  const servers = [server('halogen', 'halogen')];
  assert.deepEqual(switchRequest('local-27b-npu', 'gemma4-it:e4b', servers), {
    model: 'helena-local/Qwen3.8-27B-GGUF',
    profile: 'local-27b-npu',
    npuModel: 'gemma4-it:e4b',
  });
  assert.deepEqual(switchRequest('local-27b-npu', null, servers), {
    model: 'helena-local/Qwen3.8-27B-GGUF',
    profile: 'local-27b-npu',
  });
  assert.deepEqual(switchRequest('local-halogen', 'gemma4-it:e4b', servers), {
    model: 'helena-halogen/halogen-qwen3.8-flash-next',
    profile: 'local-halogen',
  });
  assert.equal(switchRequest('local-halogen', null, []), null);
});

test('the current profile comes from the last switch, else from the default model', () => {
  const active = { server: 'lemonade', slug: 'local', model: 'Qwen3.8-27B-GGUF' } as const;
  const maintenance = (target: object) =>
    ({ active: target, operation: null }) as GlobalModelStatus['maintenance'];
  assert.deepEqual(
    currentProfile(
      status(maintenance({ ...active, profile: 'local-27b-npu', npu: 'gemma4-it:e4b' })),
    ),
    { profile: 'local-27b-npu', npu: 'gemma4-it:e4b' },
  );
  assert.deepEqual(currentProfile(status(maintenance(active))), {
    profile: 'local-27b-npu',
    npu: null,
  });
  assert.deepEqual(currentProfile(status(null, 'helena-halogen/halogen-qwen3.8-flash-next')), {
    profile: 'local-halogen',
    npu: null,
  });
  assert.deepEqual(currentProfile(undefined), { profile: null, npu: null });
});

test('only an unfinished switch is pending', () => {
  const operation = (phase: string) =>
    status({
      admissionPaused: false,
      proxyPaused: false,
      active: null,
      operation: { id: 'a', phase, error: null } as never,
    });
  assert.equal(pendingOperation(operation('done')), null);
  assert.equal(pendingOperation(operation('rolled-back')), null);
  assert.equal(pendingOperation(operation('stopping'))?.phase, 'stopping');
  assert.equal(pendingOperation(undefined), null);
});

test('the server reasons a switch is not possible map to the owner-language texts', () => {
  assert.equal(switchErrorKey('Choose a downloaded local chat model'), 'errors.notDownloaded');
  assert.equal(switchErrorKey('The Halogen profile requires Halogen'), 'errors.noHalogen');
  assert.equal(switchErrorKey('The NPU slug belongs to another server'), 'errors.otherServer');
  assert.equal(switchErrorKey('boom'), 'errors.general');
  assert.equal(switchErrorKey(undefined), 'errors.general');
});
