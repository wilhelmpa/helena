import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LocalAiStatus } from '@/lib/api/endpoints/localAi';
import {
  classToggle,
  gib,
  gpuMemory,
  groupClasses,
  isLocalModelId,
  localShare,
  resolveLabel,
  shortModel,
  unitState,
} from './localAi';

function status(overrides: Partial<LocalAiStatus['units']> = {}): LocalAiStatus {
  const unit = { allowed: true, present: true, busyPercent: 0, loaded: [] };
  return {
    lastGpuReset: null,
    guard: {
      checkedAt: null,
      probeAt: null,
      probeMs: null,
      probeFailures: 0,
      problem: null,
      availableBytes: null,
      consumers: [],
    },
    enabled: true,
    units: {
      gpu: {
        ...unit,
        vramUsedBytes: 0,
        vramTotalBytes: 96 * 1024 ** 3,
        gttUsedBytes: 0,
        gttTotalBytes: 0,
      },
      npu: unit,
      cpu: unit,
      ...overrides,
    },
    servers: [],
    classes: [],
    usage: { days: 7, localTokens: 0, cloudTokens: 0 },
    latencyMsP50: null,
  };
}

describe('local AI card helpers', () => {
  it('reads a unit as off, missing, busy or idle', () => {
    assert.equal(unitState(status(), 'gpu'), 'idle');
    assert.equal(
      unitState(
        status({ npu: { allowed: true, present: false, busyPercent: null, loaded: [] } }),
        'npu',
      ),
      'missing',
    );
    assert.equal(
      unitState(
        status({ cpu: { allowed: false, present: true, busyPercent: 90, loaded: [] } }),
        'cpu',
      ),
      'off',
    );
    const busy = status();
    busy.units.gpu.busyPercent = 60;
    assert.equal(unitState(busy, 'gpu'), 'idle');
  });

  it('lets a class on only when nothing blocks it, and always off again', () => {
    assert.deepEqual(classToggle({ mode: 'off', blocker: 'eval-missing', experimental: false }), {
      checked: false,
      disabled: true,
      reason: 'eval-missing',
    });
    assert.deepEqual(classToggle({ mode: 'off', blocker: null, experimental: false }), {
      checked: false,
      disabled: false,
      reason: null,
    });
    // Once on, switching off is always possible, whatever the eval says now; a failed newest
    // eval (after an update) is shown, since the class runs on its configured model meanwhile.
    assert.deepEqual(classToggle({ mode: 'prefer', blocker: 'eval-failed', experimental: false }), {
      checked: true,
      disabled: false,
      reason: 'eval-failed',
    });
    assert.deepEqual(
      classToggle({ mode: 'prefer', blocker: 'eval-missing', experimental: false }),
      {
        checked: true,
        disabled: false,
        reason: null,
      },
    );
  });

  it('names local models without their provider', () => {
    assert.equal(shortModel('helena-local/Qwen3.6-35B-A3B-GGUF'), 'Qwen3.6-35B-A3B-GGUF');
    assert.equal(shortModel('gpt-5.6-luna'), 'gpt-5.6-luna');
    assert.equal(shortModel('openai/gpt-oss-120b'), 'openai/gpt-oss-120b');
    assert.ok(isLocalModelId('helena-local/x'));
    assert.ok(!isLocalModelId('anthropic/claude'));
  });

  it('counts the local share and formats sizes', () => {
    assert.equal(localShare({ days: 7, localTokens: 0, cloudTokens: 0 }), null);
    assert.equal(localShare({ days: 7, localTokens: 250, cloudTokens: 750 }), 25);
    assert.equal(gib(96 * 1024 ** 3), '96 GiB');
    assert.equal(gib(1.5 * 1024 ** 3), '1.5 GiB');
    assert.equal(gib(null), '–');
  });

  it('resolves labels from keys or a plugin text', () => {
    const t = (key: string) => `t:${key}`;
    assert.equal(
      resolveLabel({ i18n: 'localAi.classes.triage.label' }, 'de', t),
      't:classes.triage.label',
    );
    assert.equal(resolveLabel({ en: 'Hello', de: 'Hallo' }, 'de-AT', t), 'Hallo');
    assert.equal(resolveLabel('Plain', 'de', t), 'Plain');
  });
});

describe('the GPU memory the card shows', () => {
  const GiB = 1024 ** 3;
  it('is GTT with a small carve-out, VRAM with a large one', () => {
    assert.deepEqual(
      gpuMemory({
        vramUsedBytes: 0.3 * GiB,
        vramTotalBytes: 0.5 * GiB,
        gttUsedBytes: 110 * GiB,
        gttTotalBytes: 120 * GiB,
      }),
      { used: 110 * GiB, total: 120 * GiB, kind: 'gtt' },
    );
    assert.deepEqual(
      gpuMemory({
        vramUsedBytes: 20 * GiB,
        vramTotalBytes: 96 * GiB,
        gttUsedBytes: 1 * GiB,
        gttTotalBytes: 15 * GiB,
      }),
      { used: 20 * GiB, total: 96 * GiB, kind: 'vram' },
    );
    assert.equal(
      gpuMemory({
        vramUsedBytes: null,
        vramTotalBytes: null,
        gttUsedBytes: null,
        gttTotalBytes: null,
      }),
      null,
    );
  });
});

describe('the kinds of work on the settings page', () => {
  it('shows what runs and what is ready, and folds the rest', () => {
    const entries = [
      { id: 'a', mode: 'prefer' as const, blocker: null, experimental: false },
      { id: 'b', mode: 'off' as const, blocker: null, experimental: false },
      { id: 'c', mode: 'off' as const, blocker: 'eval-missing' as const, experimental: false },
      { id: 'd', mode: 'off' as const, blocker: 'not-wired' as const, experimental: false },
      { id: 'e', mode: 'off' as const, blocker: null, experimental: true },
      { id: 'f', mode: 'prefer' as const, blocker: 'eval-failed' as const, experimental: false },
    ];
    const groups = groupClasses(entries);
    assert.deepEqual(
      [groups.active, groups.ready, groups.more].map((group) => group.map((entry) => entry.id)),
      [['a', 'f'], ['b'], ['c', 'd', 'e']],
    );
  });
});
