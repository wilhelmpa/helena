import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMPTY_START_OPTIONS,
  draftFromOptions,
  hasStartOptions,
  parseStartOptions,
  sameStartOptions,
  type StartOptionsDraft,
} from './modelStartOptions';

const empty: StartOptionsDraft = draftFromOptions(null);

describe('parseStartOptions', () => {
  it('turns an empty form into the defaults', () => {
    assert.deepEqual(parseStartOptions(empty), { options: EMPTY_START_OPTIONS, errors: {} });
  });

  it('asks for the draft model with DFlash and checks its path', () => {
    const dflash = { ...empty, specType: 'draft-dflash' as const };
    assert.equal(parseStartOptions(dflash).errors.draftModel, 'draftModelRequired');
    assert.equal(
      parseStartOptions({ ...dflash, draftModel: '/tmp/model.gguf' }).errors.draftModel,
      'draftModelPath',
    );
    assert.equal(
      parseStartOptions({ ...dflash, draftModel: '/var/lib/helena-ai/models/../x.gguf' }).errors
        .draftModel,
      'draftModelPath',
    );
    const ok = parseStartOptions({
      ...dflash,
      draftModel: ' /var/lib/helena-ai/models/qwen/draft-0.6b.gguf ',
      draftTokens: '8',
    });
    assert.deepEqual(ok.errors, {});
    assert.equal(ok.options?.draftModel, '/var/lib/helena-ai/models/qwen/draft-0.6b.gguf');
    assert.equal(ok.options?.draftTokens, 8);
  });

  it('drops what does not apply to the chosen mode', () => {
    const result = parseStartOptions({
      ...empty,
      specType: 'draft-mtp',
      draftModel: '/somewhere',
      draftTokens: '',
    });
    assert.deepEqual(result.errors, {});
    assert.equal(result.options?.draftModel, null);
    const off = parseStartOptions({ ...empty, draftTokens: '99' });
    assert.deepEqual(off.errors, {});
    assert.equal(off.options?.draftTokens, null);
  });

  it('checks the ranges', () => {
    const spec = { ...empty, specType: 'draft-mtp' as const };
    assert.equal(
      parseStartOptions({ ...spec, draftTokens: '65' }).errors.draftTokens,
      'draftTokensRange',
    );
    assert.equal(
      parseStartOptions({ ...spec, draftTokens: '1.5' }).errors.draftTokens,
      'draftTokensRange',
    );
    assert.equal(parseStartOptions({ ...empty, parallel: '0' }).errors.parallel, 'parallelRange');
    assert.equal(parseStartOptions({ ...empty, parallel: '33' }).errors.parallel, 'parallelRange');
    assert.equal(
      parseStartOptions({ ...empty, contextPerSlot: '8192' }).errors.contextPerSlot,
      'contextNeedsParallel',
    );
    assert.equal(
      parseStartOptions({ ...empty, parallel: '32', contextPerSlot: '65536' }).errors
        .contextPerSlot,
      'contextTotal',
    );
    const ok = parseStartOptions({
      ...empty,
      backend: 'vulkan',
      parallel: '4',
      contextPerSlot: '32768',
    });
    assert.deepEqual(ok.options, {
      ...EMPTY_START_OPTIONS,
      backend: 'vulkan',
      parallel: 4,
      contextPerSlot: 32768,
    });
  });
});

describe('start option helpers', () => {
  it('tells custom options from the defaults', () => {
    assert.equal(hasStartOptions(null), false);
    assert.equal(hasStartOptions(EMPTY_START_OPTIONS), false);
    assert.equal(hasStartOptions({ ...EMPTY_START_OPTIONS, parallel: 2 }), true);
    assert.equal(sameStartOptions(null, EMPTY_START_OPTIONS), true);
    assert.equal(sameStartOptions(null, { ...EMPTY_START_OPTIONS, backend: 'rocm' }), false);
  });

  it('round-trips stored options through the form', () => {
    const stored = {
      backend: 'rocm' as const,
      specType: 'draft-dflash' as const,
      draftModel: '/var/lib/helena-ai/models/d.gguf',
      draftTokens: 16,
      parallel: 2,
      contextPerSlot: 65536,
    };
    assert.deepEqual(parseStartOptions(draftFromOptions(stored)).options, stored);
  });
});
