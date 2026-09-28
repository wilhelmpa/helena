import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface LocalModelOptions {
  backend: 'rocm' | 'vulkan' | null;
  specType: 'draft-mtp' | 'draft-dflash' | null;
  draftModel: string | null;
  draftTokens: number | null;
  parallel: number | null;
  contextPerSlot: number | null;
}

export const MODEL_OPTIONS_PATH =
  process.env.HELENA_LOCAL_AI_MODEL_OPTIONS ?? '/var/lib/helena-ai/config/model-options.json';

export function validateModelOptions(value: LocalModelOptions): LocalModelOptions {
  if (value.backend !== null && value.backend !== 'rocm' && value.backend !== 'vulkan')
    throw new Error('Backend must be rocm or vulkan');
  if (
    value.specType !== null &&
    value.specType !== 'draft-mtp' &&
    value.specType !== 'draft-dflash'
  )
    throw new Error('Unsupported speculative decoding type');
  if (
    value.draftModel !== null &&
    (!/^\/var\/lib\/helena-ai\/models\/[A-Za-z0-9_./-]+\.gguf$/.test(value.draftModel) ||
      value.draftModel.split('/').includes('..'))
  )
    throw new Error('Draft model must be a local GGUF under /var/lib/helena-ai/models');
  if ((value.specType === 'draft-dflash') !== (value.draftModel !== null))
    throw new Error('draft-dflash requires a draft model; other modes do not use one');
  for (const [name, number, max] of [
    ['draftTokens', value.draftTokens, 64],
    ['parallel', value.parallel, 32],
    ['contextPerSlot', value.contextPerSlot, 1_048_576],
  ] as const) {
    if (number !== null && (!Number.isInteger(number) || number < 1 || number > max))
      throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  if (value.draftTokens !== null && value.specType === null)
    throw new Error('draftTokens requires specType');
  if (value.contextPerSlot !== null && value.parallel === null)
    throw new Error('contextPerSlot requires parallel');
  if (
    value.parallel !== null &&
    value.contextPerSlot !== null &&
    value.parallel * value.contextPerSlot > 1_048_576
  )
    throw new Error('Total context exceeds 1048576 tokens');
  return value;
}

export async function readModelOptions(): Promise<Record<string, LocalModelOptions>> {
  try {
    const value: unknown = JSON.parse(await readFile(MODEL_OPTIONS_PATH, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid model options file');
    return value as Record<string, LocalModelOptions>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function saveModelOptions(id: string, options: LocalModelOptions): Promise<void> {
  validateModelOptions(options);
  const values = await readModelOptions();
  values[id] = options;
  await mkdir(dirname(MODEL_OPTIONS_PATH), { recursive: true });
  const temporary = `${MODEL_OPTIONS_PATH}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o644 });
  await chmod(temporary, 0o644);
  await rename(temporary, MODEL_OPTIONS_PATH);
}
