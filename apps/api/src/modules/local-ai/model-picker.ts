import { aiAgent, db, listModelServers } from '@repo/db';
import { eq } from 'drizzle-orm';
import { localModelId, parseLocalModelId } from '@helena/sdk';
import { readChatCatalog, readTeamChatCatalog } from '#modules/agents/chat/service';
import { LOCAL_DEFAULT, localDefaultModel, readMaintenance } from './maintenance-state';

export async function modelPicker(agentId: number, teamId?: number) {
  const [agent] = await db
    .select({ model: aiAgent.model })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  const catalog = teamId ? await readTeamChatCatalog(teamId) : await readChatCatalog(agentId);
  const standard = await localDefaultModel();
  const maintenance = await readMaintenance();
  const local = (await listModelServers()).flatMap((server) =>
    server.models
      .filter((model) => model.capabilities.includes('chat') && model.downloaded !== false)
      .map((model) => {
        let status = 'not-loaded';
        if (server.enabled && server.status?.reachable && model.loaded) status = 'running';
        if (maintenance?.admissionPaused) status = 'maintenance';
        return {
          id: localModelId(server.slug, model.id),
          name: model.id,
          group: 'local' as const,
          status,
          strength: model.capabilities.includes('tools') ? 'chat-and-tools' : 'chat',
          speed: server.kind === 'halogen' ? 'fast' : 'model-dependent',
          cost: 'no-token-cost',
          thinkingLevels:
            catalog.localModels?.find((entry) => entry.id === localModelId(server.slug, model.id))
              ?.thinkingLevels ?? [],
          selectable:
            server.enabled &&
            !!server.status?.reachable &&
            !!model.loaded &&
            !maintenance?.admissionPaused,
        };
      }),
  );
  const cloud = catalog.models
    .filter((model) => !model.local && !parseLocalModelId(model.id))
    .map((model) => ({
      ...model,
      group: 'cloud' as const,
      status: 'available',
      selectable: true,
      strength: /opus|astra|sol/.test(model.id) ? 'complex-tasks' : 'general-tasks',
      speed: /luna|haiku/.test(model.id) ? 'fast' : 'model-dependent',
      cost: 'provider-plan',
    }));
  const resolved = agent?.model === LOCAL_DEFAULT ? standard : (agent?.model ?? null);
  return {
    localDefault: { id: LOCAL_DEFAULT, model: standard },
    agentDefault: { id: null, model: resolved, local: !!parseLocalModelId(resolved) },
    groups: [
      { id: 'local' as const, models: local },
      { id: 'cloud' as const, models: cloud },
    ],
  };
}
