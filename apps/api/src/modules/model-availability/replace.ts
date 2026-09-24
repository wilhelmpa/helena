import { agentChatCatalog, aiAgent, db } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { normalizeRuntimePolicy, updateAgent } from '#modules/agents/core/service';

// "Alle umstellen": moves every agent of a team that runs one model onto another (or onto
// its runtime's default), through the agent editor's own update, so a template carries the
// change to its copies the way any edit of it does (template-sync.ts). Running it again
// changes nothing: no agent runs the old model any more.

// The reasoning levels each model offers in the team's runner catalogs.
async function teamThinkingLevels(teamId: number): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ models: agentChatCatalog.models })
    .from(agentChatCatalog)
    .innerJoin(aiAgent, eq(aiAgent.id, agentChatCatalog.agentId))
    .where(eq(aiAgent.teamId, teamId));
  const levels = new Map<string, string[]>();
  for (const row of rows) {
    for (const model of (row.models as { id: string; thinkingLevels?: string[] }[] | null) ?? []) {
      if (!levels.has(model.id)) levels.set(model.id, model.thinkingLevels ?? []);
    }
  }
  return levels;
}

export interface ReplaceResult {
  changed: { id: number; username: string; template: boolean; reasoning: string | null }[];
  followTemplate: { id: number; username: string }[];
  dryRun: boolean;
}

export async function replaceModel(
  teamId: number,
  from: string,
  to: string | null,
  options: { dryRun: boolean; actorUserId: string },
): Promise<ReplaceResult> {
  const agents = await db
    .select({
      id: aiAgent.id,
      username: aiAgent.username,
      template: aiAgent.template,
      sourceTemplateId: aiAgent.sourceTemplateId,
      templateOverrides: aiAgent.templateOverrides,
      runtimePolicy: aiAgent.runtimePolicy,
    })
    .from(aiAgent)
    .where(and(eq(aiAgent.teamId, teamId), eq(aiAgent.model, from)));
  const templates = new Set(agents.filter((agent) => agent.template).map((agent) => agent.id));
  // A copy that follows its template's model gets the new one with the template's change.
  const follows = (agent: (typeof agents)[number]) =>
    agent.sourceTemplateId != null &&
    templates.has(agent.sourceTemplateId) &&
    !(agent.templateOverrides ?? []).includes('model');
  const levels = to ? await teamThinkingLevels(teamId) : new Map<string, string[]>();
  // Templates first, so their copies are already on the new model when the list is read.
  const direct = agents
    .filter((agent) => !follows(agent))
    .sort((a, b) => Number(b.template) - Number(a.template));
  const changed: ReplaceResult['changed'] = [];
  for (const agent of direct) {
    const policy = normalizeRuntimePolicy(agent.runtimePolicy);
    // A model owns its reasoning levels (the editor's rule): the agent keeps its level when
    // the new model offers it; the runtime's default model takes the runtime's level.
    const reasoning =
      to && policy.reasoningEffort && (levels.get(to) ?? []).includes(policy.reasoningEffort)
        ? policy.reasoningEffort
        : null;
    if (!options.dryRun) {
      await updateAgent(
        agent.id,
        teamId,
        { model: to, runtimePolicy: { ...policy, reasoningEffort: reasoning } },
        options.actorUserId,
      );
    }
    changed.push({ id: agent.id, username: agent.username, template: agent.template, reasoning });
  }
  return {
    changed,
    followTemplate: agents.filter(follows).map(({ id, username }) => ({ id, username })),
    dryRun: options.dryRun,
  };
}
