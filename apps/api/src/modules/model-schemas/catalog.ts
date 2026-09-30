import { agentChatCatalog, aiAgent, db } from '@repo/db';
import { desc, eq } from 'drizzle-orm';
import { parseLocalModelId } from '@helena/sdk';
import { HttpError } from '#shared/lib';
import type { ChatCatalogModel } from '#modules/agents/chat/service';
import {
  annotateCatalog,
  loadModelAvailability,
  runtimeOfPolicy,
} from '#modules/model-availability/service';
import { localCatalogModelsNow } from '#modules/local-ai/service';
import { LOCAL_DEFAULT, localDefaultModel } from '#modules/local-ai/maintenance-state';
import type { ModelValues } from './templates';

export async function schemaCatalog() {
  const [rows, availability, local, standard] = await Promise.all([
    db
      .select({ models: agentChatCatalog.models, policy: aiAgent.runtimePolicy })
      .from(agentChatCatalog)
      .innerJoin(aiAgent, eq(aiAgent.id, agentChatCatalog.agentId))
      .orderBy(desc(agentChatCatalog.updatedAt)),
    loadModelAvailability(),
    localCatalogModelsNow(),
    localDefaultModel(),
  ]);
  const models = new Map<string, ChatCatalogModel & { runtime: string }>();
  for (const row of rows) {
    const runtime = runtimeOfPolicy(row.policy);
    for (const model of annotateCatalog(row.models as ChatCatalogModel[], runtime, availability)
      .models) {
      if (model.local || parseLocalModelId(model.id) || model.id === LOCAL_DEFAULT) continue;
      const key = `${runtime}:${model.id}`;
      if (!models.has(key)) models.set(key, { ...model, runtime });
    }
  }
  for (const runtime of ['helena', 'hermes']) {
    for (const model of local) models.set(`${runtime}:${model.id}`, { ...model, runtime });
    const resolved = local.find((model) => model.id === standard);
    if (resolved)
      models.set(`${runtime}:${LOCAL_DEFAULT}`, { ...resolved, id: LOCAL_DEFAULT, runtime });
  }
  return [...models.values()];
}

export function validateCatalogValues(
  values: ModelValues,
  catalog: Awaited<ReturnType<typeof schemaCatalog>>,
) {
  const model = catalog.find(
    (entry) => entry.runtime === values.runtime && entry.id === values.model,
  );
  if (!model)
    throw new HttpError(400, `Model ${values.model} is unavailable for ${values.runtime}`);
  if (values.reasoning !== null && !model.thinkingLevels.includes(values.reasoning))
    throw new HttpError(400, `Invalid reasoning for ${values.model}`);
  const escalation = values.escalation;
  if (
    escalation.model &&
    escalation.maxDepth > 0 &&
    !catalog.some(
      (entry) => entry.runtime === (escalation.target ?? 'codex') && entry.id === escalation.model,
    )
  )
    throw new HttpError(
      400,
      `Escalation model ${escalation.model} is unavailable for ${escalation.target ?? 'codex'}`,
    );
}
