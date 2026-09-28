import type { LocalModelStartOptions } from '@/lib/api/endpoints/localAi';

// The start options of a local model as the form holds them (numbers as typed text) and the
// same checks the API makes (apps/api/src/modules/local-ai/model-options.ts), so a mistake
// shows under its field before anything is sent.

export type StartOptionsDraft = {
  backend: LocalModelStartOptions['backend'];
  specType: LocalModelStartOptions['specType'];
  draftModel: string;
  draftTokens: string;
  parallel: string;
  contextPerSlot: string;
};

export type StartOptionsField = 'draftModel' | 'draftTokens' | 'parallel' | 'contextPerSlot';

// A key of `localAi.startOptions.errors`.
export type StartOptionsError =
  | 'draftModelRequired'
  | 'draftModelPath'
  | 'draftTokensRange'
  | 'parallelRange'
  | 'contextRange'
  | 'contextNeedsParallel'
  | 'contextTotal';

export const MAX_DRAFT_TOKENS = 64;
export const MAX_PARALLEL = 32;
export const MAX_TOTAL_CONTEXT = 1_048_576;

const DRAFT_MODEL_PATH = /^\/var\/lib\/helena-ai\/models\/[A-Za-z0-9_./-]+\.gguf$/;

export const EMPTY_START_OPTIONS: LocalModelStartOptions = {
  backend: null,
  specType: null,
  draftModel: null,
  draftTokens: null,
  parallel: null,
  contextPerSlot: null,
};

export function draftFromOptions(
  options: LocalModelStartOptions | null | undefined,
): StartOptionsDraft {
  const value = options ?? EMPTY_START_OPTIONS;
  const text = (number: number | null) => (number === null ? '' : String(number));
  return {
    backend: value.backend,
    specType: value.specType,
    draftModel: value.draftModel ?? '',
    draftTokens: text(value.draftTokens),
    parallel: text(value.parallel),
    contextPerSlot: text(value.contextPerSlot),
  };
}

// Whether any option differs from Lemonade's default.
export function hasStartOptions(options: LocalModelStartOptions | null | undefined): boolean {
  if (!options) return false;
  return Object.values(options).some((value) => value !== null);
}

// A whole number from 1 to max, `null` when the field is empty, `undefined` when it is not one.
function wholeNumber(text: string, max: number): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const number = Number(trimmed);
  return number >= 1 && number <= max ? number : undefined;
}

// The options to save, or the first mistake of each field. A field that does not apply to
// the chosen mode (the draft model without DFlash, the draft tokens without speculative
// decoding) is dropped, not reported.
export function parseStartOptions(draft: StartOptionsDraft): {
  options: LocalModelStartOptions | null;
  errors: Partial<Record<StartOptionsField, StartOptionsError>>;
} {
  const errors: Partial<Record<StartOptionsField, StartOptionsError>> = {};
  let draftModel: string | null = null;
  if (draft.specType === 'draft-dflash') {
    const path = draft.draftModel.trim();
    if (path === '') errors.draftModel = 'draftModelRequired';
    else if (!DRAFT_MODEL_PATH.test(path) || path.split('/').includes('..'))
      errors.draftModel = 'draftModelPath';
    else draftModel = path;
  }
  let draftTokens: number | null = null;
  if (draft.specType !== null) {
    const value = wholeNumber(draft.draftTokens, MAX_DRAFT_TOKENS);
    if (value === undefined) errors.draftTokens = 'draftTokensRange';
    else draftTokens = value;
  }
  const parallel = wholeNumber(draft.parallel, MAX_PARALLEL);
  if (parallel === undefined) errors.parallel = 'parallelRange';
  const contextPerSlot = wholeNumber(draft.contextPerSlot, MAX_TOTAL_CONTEXT);
  if (contextPerSlot === undefined) errors.contextPerSlot = 'contextRange';
  else if (contextPerSlot !== null && parallel === null && !errors.parallel)
    errors.contextPerSlot = 'contextNeedsParallel';
  else if (
    contextPerSlot !== null &&
    typeof parallel === 'number' &&
    parallel * contextPerSlot > MAX_TOTAL_CONTEXT
  )
    errors.contextPerSlot = 'contextTotal';
  if (Object.keys(errors).length > 0) return { options: null, errors };
  return {
    options: {
      backend: draft.backend,
      specType: draft.specType,
      draftModel,
      draftTokens,
      parallel: parallel ?? null,
      contextPerSlot: contextPerSlot ?? null,
    },
    errors,
  };
}

export function sameStartOptions(
  a: LocalModelStartOptions | null | undefined,
  b: LocalModelStartOptions | null | undefined,
): boolean {
  const left = a ?? EMPTY_START_OPTIONS;
  const right = b ?? EMPTY_START_OPTIONS;
  return (Object.keys(EMPTY_START_OPTIONS) as (keyof LocalModelStartOptions)[]).every(
    (key) => left[key] === right[key],
  );
}
