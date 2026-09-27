import { describe, expect, it } from 'bun:test';
import type { UpdateCheckContext } from '@helena/sdk';
import { whisperUpdateCandidate } from './whisper-update';

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
