import type { AiAgent } from '@/lib/api/endpoints/agents';

// How much text each part of an agent's context may hold, and how much of it is used
// (docs/helena-decisions: limits like Hermes': MEMORY 2 200 characters, USER 1 375, SOUL and
// instructions 20 000 by default). The API delivers them per agent as `sizeLimits`; an older
// server sends none, and then nothing about limits is shown — except where the API's own
// hard cap applies.
export type LimitArea =
  'memory' | 'user' | 'dailyNote' | 'soul' | 'agentInstructions' | 'projectInstructions';

export interface SizeLimit {
  used: number;
  limit: number;
  // The text is longer than the limit, so the model sees a shortened version.
  truncated?: boolean;
}

export type SizeLimits = Partial<Record<LimitArea, SizeLimit>>;

export const LIMIT_AREAS: LimitArea[] = [
  'memory',
  'user',
  'dailyNote',
  'soul',
  'agentInstructions',
  'projectInstructions',
];

// The limit of a text file of the memory: MEMORY.md and USER.md.
export function memoryArea(file: string): 'memory' | 'user' {
  return file === 'USER.md' ? 'user' : 'memory';
}

// What the server reports for the agent, or nothing.
export function agentSizeLimits(agent: Pick<AiAgent, 'sizeLimits'> | null | undefined): SizeLimits {
  const limits: unknown = agent?.sizeLimits;
  if (!limits || typeof limits !== 'object') return {};
  const result: SizeLimits = {};
  for (const area of LIMIT_AREAS) {
    const value = (limits as Record<string, Partial<SizeLimit> | undefined>)[area];
    if (value && typeof value.limit === 'number' && value.limit > 0) {
      result[area] = {
        used: typeof value.used === 'number' ? value.used : 0,
        limit: value.limit,
        ...(value.truncated ? { truncated: true } : {}),
      };
    }
  }
  return result;
}

export type LimitState = 'ok' | 'warning' | 'full';

// Full at the limit itself, a warning from above 90 %.
export function limitState(used: number, limit: number): LimitState {
  if (limit <= 0) return 'ok';
  if (used > limit) return 'full';
  if (used / limit > 0.9) return 'warning';
  return 'ok';
}

// Whether a text of this length may be saved.
export function withinLimit(used: number, limit: number | null | undefined): boolean {
  return limit == null || used <= limit;
}
