import { t } from 'elysia';

import { agentParams } from '../model';
import { INSTRUCTIONS_FILE_PATTERN, MEMORY_FILE_PATTERN } from './paths';

export { agentParams };

const runtimeFilePath = t.String({ minLength: 1, maxLength: 160 });

export const AgentRuntimeFileResponse = t.Object({
  path: runtimeFilePath,
  kind: t.Union([t.Literal('instructions'), t.Literal('memory')]),
  content: t.String(),
});

export const AgentRuntimeFileListResponse = t.Array(AgentRuntimeFileResponse);

export const upsertRuntimeFileBody = t.Object({
  path: runtimeFilePath,
  content: t.String({ maxLength: 131072 }),
});

export const runtimeFileQuery = t.Object({ path: runtimeFilePath });

export const instructionsRuntimeFile = t.Object({
  kind: t.Literal('instructions'),
  path: t.String({
    minLength: 1,
    maxLength: 160,
    pattern: INSTRUCTIONS_FILE_PATTERN,
  }),
  content: t.String({ maxLength: 131072 }),
});

export const memoryRuntimeFile = t.Object({
  kind: t.Literal('memory'),
  path: t.String({ minLength: 1, maxLength: 160, pattern: MEMORY_FILE_PATTERN }),
  content: t.String({ maxLength: 131072 }),
});
