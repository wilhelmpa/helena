import { test, expect } from 'bun:test';
import { validateModelOptions } from './model-options';

test('model start options require valid MTP and a bounded total slot context', () => {
  const valid = {
    backend: 'vulkan' as const,
    specType: 'draft-mtp' as const,
    draftModel: null,
    draftTokens: 2,
    parallel: 2,
    contextPerSlot: 65536,
  };
  expect(validateModelOptions(valid)).toEqual(valid);
  expect(() => validateModelOptions({ ...valid, contextPerSlot: 1_048_576 })).toThrow();
  expect(() => validateModelOptions({ ...valid, parallel: null })).toThrow();
  expect(() => validateModelOptions({ ...valid, specType: null })).toThrow();
  expect(() => validateModelOptions({ ...valid, specType: 'draft-dflash' })).toThrow();
  expect(
    validateModelOptions({
      ...valid,
      specType: 'draft-dflash',
      draftModel: '/var/lib/helena-ai/models/draft.gguf',
    }).draftModel,
  ).toBe('/var/lib/helena-ai/models/draft.gguf');
});
