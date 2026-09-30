import { isDeepStrictEqual } from 'node:util';
import { normalizeAgentEscalation } from '#modules/agents/core/service';
import { HttpError } from '#shared/lib';
import { MODEL_TEMPLATES, ROLE_TOOL_PROFILES, type ModelRole, type ModelSchema } from './templates';

export function migrateEscalationValue(value: unknown, runtimeEscalation?: unknown) {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object' || !('failures' in raw || 'stalledSteps' in raw))
    return normalizeAgentEscalation(value);
  if (runtimeEscalation && typeof runtimeEscalation === 'object')
    return normalizeAgentEscalation(runtimeEscalation);
  const target = typeof raw.target === 'string' ? raw.target : '';
  const match = /^runtime:(claude|codex)(?:\/(.+))?$/.exec(target);
  if (target && !match)
    throw new HttpError(409, 'Legacy escalation target needs an explicit Claude or Codex policy');
  return normalizeAgentEscalation({
    target: match?.[1] ?? 'codex',
    model: match?.[2] ?? null,
    afterFailures: target ? Math.min(5, Number(raw.failures) || 0) : 0,
    onResumeLimit: Boolean(target && Number(raw.stalledSteps) > 0),
    onRequest: Boolean(target && raw.onRequest),
    maxDepth: target ? 1 : 0,
  });
}

export function migrateSchemaEscalations<
  T extends {
    schemas: Record<string, ModelSchema>;
    history?: { schemas: Record<string, ModelSchema> }[];
  },
>(state: T): T {
  const next = structuredClone(state);
  for (const snapshot of [next, ...(next.history ?? [])]) {
    for (const schema of Object.values(snapshot.schemas)) {
      for (const [role, values] of Object.entries(schema.roles)) {
        values.toolProfile ??= ROLE_TOOL_PROFILES[role as ModelRole] ?? 'assistent';
        const raw = values.escalation as unknown as Record<string, unknown>;
        const builtIn = MODEL_TEMPLATES[schema.id]?.roles[role]?.escalation;
        const previousLocalDefault =
          schema.id === 'nur-lokal' &&
          isDeepStrictEqual(raw, MODEL_TEMPLATES['nur-lokal']!.roles.general!.escalation);
        const oldDefault =
          raw &&
          ((raw.target === 'runtime:codex/gpt-6-sol' &&
            raw.failures === 2 &&
            raw.stalledSteps === 12 &&
            raw.onRequest === true) ||
            (raw.target === null && raw.failures === 0 && raw.stalledSteps === 0));
        values.escalation =
          builtIn && (oldDefault || previousLocalDefault || !raw)
            ? { ...builtIn }
            : migrateEscalationValue(raw);
      }
    }
  }
  return next;
}
