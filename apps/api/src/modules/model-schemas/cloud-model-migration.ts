import { CLOUD_AGENT_MODELS, type ModelSchema } from './templates';

export function migrateCloudModels(schemas: Record<string, ModelSchema>) {
  const next = structuredClone(schemas);
  const changes: { schema: string; role: string; from: string; to: string }[] = [];
  for (const schema of Object.values(next)) {
    for (const [role, values] of Object.entries(schema.roles)) {
      const legacy =
        values.runtime === 'codex'
          ? ['gpt-6-sol', 'gpt-6-luna'].includes(values.model)
          : values.runtime === 'claude' && values.model === 'claude-sonnet-5';
      if (!legacy || (values.runtime !== 'codex' && values.runtime !== 'claude')) continue;
      const to = CLOUD_AGENT_MODELS[values.runtime];
      changes.push({ schema: schema.id, role, from: values.model, to });
      values.model = to;
    }
  }
  return { schemas: next, changes };
}

export function cloudAgentUpgrades(
  agents: { id: number; overrides: Record<string, unknown> }[],
  resolved: { id: number; schema: string; role: string }[],
  changes: ReturnType<typeof migrateCloudModels>['changes'],
) {
  return agents.flatMap((agent) => {
    if (agent.overrides.model !== undefined && agent.overrides.model !== null) return [];
    const row = resolved.find((item) => item.id === agent.id);
    const change = changes.find((item) => item.schema === row?.schema && item.role === row.role);
    return change ? [{ agentId: agent.id, ...change }] : [];
  });
}

export function cloudModelAudit(
  catalog: { runtime: string; models: { id: string }[] }[],
  availability: { runtime: string; model: string; state: string }[],
  prices: { model: string }[],
) {
  return Object.entries(CLOUD_AGENT_MODELS).map(([runtime, model]) => {
    const matches = (id: string) =>
      typeof id === 'string' && (id === model || id.endsWith(`/${model}`));
    const observations = availability.filter(
      (entry) => entry.runtime === runtime && matches(entry.model),
    );
    return {
      runtime,
      model,
      inCatalog: catalog.some(
        (entry) => entry.runtime === runtime && entry.models.some((item) => matches(item.id)),
      ),
      available: observations.some((entry) => entry.state === 'unavailable')
        ? false
        : observations.some((entry) => entry.state === 'works')
          ? true
          : null,
      pricePresent: prices.some((entry) => matches(entry.model)),
    };
  });
}
