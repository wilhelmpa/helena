import { describe, expect, it } from 'bun:test';
import type { ModelServerRow } from '@repo/db';
import { normalizeUpdateCandidate, type UpdateCheckContext } from '@helena/sdk';
import { checkWatchedModels, type WatchedModel } from './model-watch';
import { configuredModelWatch } from './model-watch-config';

const baseline = 'a'.repeat(40);
const latest = 'b'.repeat(40);
const watch: WatchedModel = {
  name: 'Qwen3.8-27B',
  repo: 'unsloth/Qwen3.8-27B-GGUF',
  revision: baseline,
  files: ['Qwen3.8-27B-UD-Q4_K_XL.gguf', 'mmproj-F16.gguf'],
  bytes: 20_000_000_000,
};
const model = (repo = watch.repo!, bytes = 20_000_000_000) => ({
  id: repo,
  sha: latest,
  lastModified: '2026-09-30T08:00:00Z',
  cardData: { license: 'apache-2.0' },
  siblings: [
    {
      rfilename: `Qwen${repo.includes('3.9') ? '3.9' : '3.8'}-27B-UD-Q4_K_XL.gguf`,
      lfs: { size: bytes },
    },
    { rfilename: 'mmproj-F16.gguf', size: 1_000_000_000 },
    { rfilename: 'Qwen3.8-27B-F16.gguf', lfs: { size: 999_000_000_000 } },
  ],
});
function context(info: unknown = model(), families: string[] = []) {
  const requests: string[] = [];
  const ctx: UpdateCheckContext = {
    now: new Date(),
    manual: false,
    log: { info() {}, warn() {}, error() {} },
    inventory: async () => null,
    fetchText: async () => {
      throw new Error('No downloads or text requests allowed');
    },
    fetchJson: async <T>(url: string): Promise<T> => {
      requests.push(url);
      expect(url).toStartWith('https://huggingface.co/api/models');
      expect(url).not.toContain('/resolve/');
      if (url.includes('?author=')) return families.map((id) => ({ id })) as T;
      expect(url).toEndWith('?blobs=true');
      if (url.includes('Qwen3.9')) return model('unsloth/Qwen3.9-27B-GGUF') as T;
      return info as T;
    },
  };
  return { ctx, requests };
}

describe('configured model observation', () => {
  it('uses a configured checkpoint override rather than the profile default repository', async () => {
    const server = {
      kind: 'lemonade',
      enabled: true,
      slug: 'local',
      models: [
        {
          id: 'Qwen3.8-27B-GGUF',
          name: 'Custom 27B',
          checkpoint: 'other/Qwen3.8-27B-GGUF:Qwen3.8-27B-Q8_0.gguf',
          loaded: true,
          capabilities: ['chat'],
        },
      ],
    } as unknown as ModelServerRow;
    const sources = await configuredModelWatch([server], [], null);
    expect(sources.map((source) => source.repo)).toEqual(['other/Qwen3.8-27B-GGUF']);
    expect(sources[0]!.files).toContain('Qwen3.8-27B-Q8_0.gguf');
  });
  it('counts every GGUF shard instead of treating the small first shard as the model', async () => {
    const info = {
      ...model(),
      siblings: [
        { rfilename: 'weights-00001-of-00002.gguf', size: 1_000_000 },
        { rfilename: 'weights-00002-of-00002.gguf', size: 120_000_000_000 },
      ],
    };
    const [result] = await checkWatchedModels(
      [{ ...watch, files: ['weights-00001-of-00002.gguf'] }],
      context(info).ctx,
    );
    expect(result!.data?.modelNotice).toMatchObject({ fits: false, sizeBytes: 120_001_000_000 });
  });
  it('keeps unknown configured models with spaces in the update contract', async () => {
    const { ctx, requests } = context();
    const [result] = await checkWatchedModels(
      [{ name: 'TTS: custom model.gguf', repo: null, revision: null, files: [], bytes: 0 }],
      ctx,
    );
    expect(normalizeUpdateCandidate(result)).toMatchObject({
      data: { modelNotice: { fits: false, repository: null } },
    });
    expect(requests).toEqual([]);
  });
  it('reports a new revision with provenance, selected file size, license and date without a download', async () => {
    const { ctx, requests } = context();
    const [result] = await checkWatchedModels([watch], ctx);
    expect(result).toMatchObject({
      updateAvailable: true,
      applicable: false,
      installed: null,
      available: latest,
      hint: { de: 'Neue Version verfügbar – vor dem Wechsel auswerten' },
      data: {
        modelNotice: {
          repository: watch.repo,
          revision: latest,
          sizeBytes: 21_000_000_000,
          license: 'apache-2.0',
          date: '2026-09-30T08:00:00.000Z',
          fits: true,
        },
      },
    });
    expect(requests).toHaveLength(2);
  });
  it('includes only newer versions of a configured family from its publisher', async () => {
    const { ctx } = context(model(), [
      'Qwen/Qwen4-60B-A6B',
      'unsloth/Qwen4-235B-GGUF',
      'other/Qwen3.9-27B-GGUF',
      'unsloth/Qwen9-27B-GGUF/resolve/main/model.gguf',
      'unsloth/Qwen3.9-27B-GGUF',
    ]);
    const results = await checkWatchedModels([watch], ctx);
    expect(results.map((result) => result.component)).toEqual([
      'watch:unsloth/Qwen3.8-27B-GGUF',
      'watch:unsloth/Qwen3.9-27B-GGUF',
    ]);
    expect(results[1]!.data?.modelNotice).toMatchObject({
      fits: true,
      repository: 'unsloth/Qwen3.9-27B-GGUF',
    });
  });
  it('marks oversized and incomplete models as not fitting without hiding the revision', async () => {
    for (const info of [
      model(watch.repo!, 120_000_000_000),
      { ...model(), cardData: {}, siblings: [] },
    ]) {
      const [result] = await checkWatchedModels([watch], context(info).ctx);
      expect(result).toMatchObject({ updateAvailable: true, applicable: false, available: latest });
      expect(result!.data?.modelNotice).toMatchObject({ fits: false });
      expect(result!.detail).toContain('passt nicht');
    }
  });
  it('retains a proven revision result when the family lookup fails', async () => {
    const { ctx } = context();
    const fetch = ctx.fetchJson;
    ctx.fetchJson = async (url, options) => {
      if (url.includes('?author=')) throw new Error('Unavailable');
      return fetch(url, options);
    };
    const results = await checkWatchedModels([watch], ctx);
    expect(results).toHaveLength(1);
    expect(results[0]!.data?.modelNotice).toMatchObject({ fits: true });
  });
  it('uses the configured Halogen and paired profile, excluding unused catalog families', async () => {
    const server = {
      kind: 'halogen',
      enabled: true,
      name: 'Halogen',
      models: [],
      slug: 'halogen',
    } as unknown as ModelServerRow;
    const sources = await configuredModelWatch([server], [], null);
    expect(sources.map((source) => source.repo)).toEqual([
      'peonist-ai/halogen-qwen3.8-flash-next',
      'unsloth/Qwen3.8-Flash-Next-GGUF',
      'unsloth/Qwen3.8-27B-GGUF',
    ]);
    expect(sources[0]!.companionBytes).toBe(93_682_584_224);
  });
  it('derives voice and embedding sources from selected files and reports unknown NPU provenance', async () => {
    const server = {
      kind: 'fastflowlm',
      enabled: true,
      name: 'NPU',
      models: [],
      slug: 'volition-npu',
    } as unknown as ModelServerRow;
    const sources = await configuredModelWatch([server], [], {
      voice: {
        whisper: { present: true, modelFiles: ['whisper-large-v3-turbo-german-q5_0.bin'] },
        qwentts: {
          present: true,
          modelFiles: ['qwen-talker-1.7b-base-Q8_0.gguf', 'qwen-tokenizer-12hz-Q8_0.gguf'],
        },
      },
      embedding: { present: true, modelFiles: ['Qwen3-Embedding-0.6B-Q8_0.gguf'] },
    });
    expect(
      sources.find((source) => source.repo === 'cstr/whisper-large-v3-turbo-german-ggml')?.files,
    ).toEqual(['ggml-model-q5_0.bin']);
    expect(sources.find((source) => source.repo === 'Serveurperso/Qwen3-TTS-GGUF')?.files).toEqual([
      'qwen-talker-1.7b-base-Q8_0.gguf',
      'qwen-tokenizer-12hz-Q8_0.gguf',
    ]);
    expect(sources.some((source) => source.repo === 'Qwen/Qwen3-Embedding-0.6B-GGUF')).toBe(true);
    const unknown = sources.find((source) => source.name === 'qwen3.5:4b')!;
    const { ctx, requests } = context();
    const [result] = await checkWatchedModels([unknown], ctx);
    expect(result!.data?.modelNotice).toMatchObject({ fits: false, repository: null });
    expect(requests).toEqual([]);
  });
});
