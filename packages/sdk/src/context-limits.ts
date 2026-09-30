// Character limits shared by the API, runner and native agent loop. A missing override
// inherits the team's setting; a missing team setting uses these Hermes-sized defaults.
export const CONTEXT_LIMIT_DEFAULTS = {
  memory: 2200,
  user: 1375,
  dailyNote: 20_000,
  soul: 20_000,
  agentInstructions: 20_000,
  projectInstructions: 20_000,
  teamInstructions: 20_000,
  skillDescription: 60,
  loadedSkills: 8,
} as const;

export type ContextLimitKey = keyof typeof CONTEXT_LIMIT_DEFAULTS;
export type ContextLimits = Partial<Record<ContextLimitKey, number>>;

export function normalizeContextLimits(value: unknown): ContextLimits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const result: ContextLimits = {};
  for (const key of Object.keys(CONTEXT_LIMIT_DEFAULTS) as ContextLimitKey[]) {
    const n = raw[key];
    const maximum = key === 'loadedSkills' ? 100 : 500_000;
    if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= maximum) result[key] = n;
  }
  return result;
}

export function effectiveContextLimits(team: unknown, agent: unknown) {
  return {
    ...CONTEXT_LIMIT_DEFAULTS,
    ...normalizeContextLimits(team),
    ...normalizeContextLimits(agent),
  };
}

// Hermes reserves 6% of the model window for each context file, bounded to 20k–500k
// characters. Four characters per token is the same estimate used by the loop.
export function contextFileLimit(
  contextTokens: number,
  configured: number,
  overridden = false,
): number {
  const dynamic = Math.max(20_000, Math.min(500_000, Math.floor(contextTokens * 0.06 * 4)));
  return overridden ? configured : dynamic;
}

export function truncateContext(text: string, limit: number) {
  if (text.length <= limit)
    return { content: text, truncated: false, charsBefore: text.length, charsAfter: text.length };
  const marker = '\n\n[Context truncated: head and tail retained]\n\n';
  if (limit <= marker.length + 2)
    return {
      content: text.slice(0, limit),
      truncated: true,
      charsBefore: text.length,
      charsAfter: limit,
    };
  const head = Math.min(Math.floor(limit * 0.7), limit - marker.length);
  const tail = Math.max(0, Math.min(Math.floor(limit * 0.2), limit - marker.length - head));
  const content = text.slice(0, head) + marker + (tail ? text.slice(-tail) : '');
  return { content, truncated: true, charsBefore: text.length, charsAfter: content.length };
}
