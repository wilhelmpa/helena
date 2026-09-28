import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UpdateCheckContext } from '@helena/sdk';
import { applyWhisperUpdate, whisperUpdateCandidate } from './whisper-update';

const feed =
  '<feed><entry><title>v1.9.4</title><link href="https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.4"/></entry><entry><title>v2.0.0-rc1</title><link href="https://github.com/ggml-org/whisper.cpp/releases/tag/v2.0.0-rc1"/></entry></feed>';
function context(
  whisper?: Record<string, unknown>,
  fetchText = async () => feed,
): UpdateCheckContext {
  return {
    now: new Date(),
    manual: false,
    log: { info() {}, warn() {}, error() {} },
    inventory: async () => ({ voice: { whisper } }),
    fetchText: async (url) => {
      expect(url).toBe('https://github.com/ggml-org/whisper.cpp/releases.atom');
      return fetchText();
    },
    fetchJson: async () => {
      throw new Error('Unexpected request');
    },
  };
}
const installed = {
  present: true,
  version: '1.8.4',
  state: 'active',
  versionSource: 'running-executable-path',
};

describe('Whisper software status', () => {
  it('compares a proven running version against the stable official release without apply', async () => {
    const result = await whisperUpdateCandidate(context(installed));
    expect(result).toMatchObject({
      component: 'whisper-cpp',
      installed: '1.8.4',
      available: '1.9.4',
      updateAvailable: true,
      applicable: false,
      error: null,
      hint: { i18n: 'localAi.updates.whisperBuildRequired' },
      sourceUrl: 'https://github.com/ggml-org/whisper.cpp',
    });
  });
  it('omits an absent service but never labels an unverified or stopped version current', async () => {
    expect(await whisperUpdateCandidate(context())).toBeNull();
    expect(await whisperUpdateCandidate(context({ present: false }))).toBeNull();
    for (const fields of [
      { version: null },
      { state: 'failed' },
      { versionSource: 'model-name' },
    ]) {
      expect(await whisperUpdateCandidate(context({ ...installed, ...fields }))).toMatchObject({
        installed: null,
        applicable: false,
        available: '1.9.4',
        updateAvailable: false,
      });
      expect(
        (await whisperUpdateCandidate(context({ ...installed, ...fields })))?.error,
      ).toBeTruthy();
    }
  });
  it('retains an explicit unknown state when release metadata is missing or fails', async () => {
    for (const read of [
      async () => '<feed/>',
      async () => {
        throw new Error('release check failed');
      },
    ]) {
      const result = await whisperUpdateCandidate(context(installed, read));
      expect(result?.installed).toBe('1.8.4');
      expect(result?.available).toBeNull();
      expect(result?.error).toBeTruthy();
      expect(result?.applicable).toBe(false);
    }
  });
});

it('offers only the prepared target inside its verified maintenance window', async () => {
  for (const update of [
    undefined,
    { ready: true, version: '1.9.5', expiresAt: Date.now() / 1000 + 120 },
    { ready: true, version: '1.9.4', expiresAt: Date.now() / 1000 - 1 },
    { ready: false, version: '1.9.4', code: 'recovery-required' },
    { ready: false, version: '1.9.4', code: 'maintenance-required' },
  ]) {
    expect((await whisperUpdateCandidate(context({ ...installed, update })))?.applicable).toBe(
      false,
    );
  }
  const ready = await whisperUpdateCandidate(
    context({
      ...installed,
      update: { ready: true, code: 'ready', version: '1.9.4', expiresAt: Date.now() / 1000 + 120 },
    }),
  );
  expect(ready).toMatchObject({ applicable: true, hint: null, available: '1.9.4' });
  expect(
    (
      await whisperUpdateCandidate(
        context({ ...installed, update: { ready: false, code: 'maintenance-required' } }),
      )
    )?.hint,
  ).toEqual({ i18n: 'localAi.updates.whisperMaintenanceRequired' });
  expect(
    (
      await whisperUpdateCandidate(
        context({ ...installed, update: { ready: false, code: 'recovery-required' } }),
      )
    )?.hint,
  ).toEqual({ i18n: 'localAi.updates.whisperRecoveryRequired' });
});

it('dispatches only the exact prepared package into the actual helper spool', async () => {
  const spool = await mkdtemp(join(tmpdir(), 'helena-whisper-ui-'));
  const previous = process.env.HELENA_UPDATE_SPOOL;
  process.env.HELENA_UPDATE_SPOOL = spool;
  try {
    await mkdir(join(spool, 'requests'));
    await mkdir(join(spool, 'status'));
    const candidate = (await whisperUpdateCandidate(
      context({
        ...installed,
        update: {
          ready: true,
          code: 'ready',
          version: '1.9.4',
          expiresAt: Date.now() / 1000 + 120,
        },
      }),
    ))!;
    for (const fields of [
      { component: 'model:qwen' },
      { target: '1.9.5' },
      { candidate: { ...candidate, applicable: false } },
      { components: [candidate, { ...candidate, component: 'lemonade' }] },
    ])
      await expect(
        applyWhisperUpdate({ component: 'whisper-cpp', target: '1.9.4', candidate, ...fields }),
      ).rejects.toThrow();
    expect(await readdir(join(spool, 'requests'))).toEqual([]);
    const { ref } = await applyWhisperUpdate({
      component: 'whisper-cpp',
      target: '1.9.4',
      candidate,
    });
    expect(JSON.parse(await readFile(join(spool, 'requests', `${ref}.json`), 'utf8'))).toEqual({
      id: ref,
      action: 'whisper-ui',
      version: '1.9.4',
    });
  } finally {
    if (previous === undefined) delete process.env.HELENA_UPDATE_SPOOL;
    else process.env.HELENA_UPDATE_SPOOL = previous;
    await rm(spool, { recursive: true, force: true });
  }
});
