import { aiAgent, agentSkillLink, agentToolLink, db, organizationAgentAssignment } from '@repo/db';
import { MODEL_ROLES } from '../modules/model-schemas/templates';
import {
  applyMatrix,
  modelProjectionDrift,
  previewMatrix,
  readModelState,
  syncAgentModel,
} from '../modules/model-schemas/service';

const ROLE_WORDS: [RegExp, string][] = [
  [/koordinat|coordinat|lead/i, 'coordinator'],
  [/programm|cod(er|ing)|entwick|software/i, 'coder'],
  [/review|prüf|qualit/i, 'reviewer'],
  [/plan|architekt/i, 'planning'],
  [/research|recherche|suche/i, 'research'],
  [/content|seo|text|redak/i, 'content'],
  [/assistenz|assistant/i, 'assistant'],
  [/finanz|beleg|buchhalt|rechnung/i, 'finance'],
  [/trad|signal|markt/i, 'trading'],
  [/browser|operator/i, 'browser'],
  [/support|hilfe/i, 'support'],
  [/devops|betrieb|infra/i, 'devops'],
];
export function inferModelRole(
  agent: { agentRole: string; username: string },
  assignment?: {
    role: string | null;
    roleTitle: string;
    capabilities: string[];
  } | null,
): string {
  if (agent.agentRole === 'home') return 'home';
  if (assignment?.role === 'coordinator' || assignment?.role === 'reviewer') return assignment.role;
  for (const words of [
    assignment?.roleTitle,
    (assignment?.capabilities ?? []).join(' '),
    agent.username,
  ]) {
    for (const [pattern, role] of ROLE_WORDS) if (pattern.test(words ?? '')) return role;
  }
  if (assignment?.role && MODEL_ROLES.includes(assignment.role as never)) return assignment.role;
  return 'general';
}

export async function modelSchemaMigration(apply = false) {
  const [state, agents, assignments, skills, tools, drift] = await Promise.all([
    readModelState(),
    db
      .select({
        id: aiAgent.id,
        username: aiAgent.username,
        agentRole: aiAgent.agentRole,
        role: aiAgent.modelRole,
        overrides: aiAgent.modelOverrides,
        model: aiAgent.model,
        policy: aiAgent.runtimePolicy,
        sourceTemplateId: aiAgent.sourceTemplateId,
      })
      .from(aiAgent),
    db
      .select({
        agentId: organizationAgentAssignment.agentId,
        role: organizationAgentAssignment.role,
        roleTitle: organizationAgentAssignment.roleTitle,
        capabilities: organizationAgentAssignment.capabilities,
      })
      .from(organizationAgentAssignment),
    db.select({ agentId: agentSkillLink.agentId }).from(agentSkillLink),
    db.select({ agentId: agentToolLink.agentId }).from(agentToolLink),
    modelProjectionDrift(),
  ]);
  const changes = agents.flatMap((agent) => {
    const assignment = assignments.find((item) => item.agentId === agent.id);
    const role = inferModelRole(agent, assignment);
    return role !== agent.role && agent.overrides.role === undefined
      ? [{ agentId: agent.id, role, values: {} }]
      : [];
  });
  const preview = await previewMatrix({ expectedRevision: state.revision, agents: changes });
  const audit = agents.map((agent) => {
    const policy = agent.policy as { files?: { path?: string }[] };
    return {
      id: agent.id,
      username: agent.username,
      currentRole: agent.role,
      suggestedRole: changes.find((change) => change.agentId === agent.id)?.role ?? agent.role,
      own: Object.keys(agent.overrides ?? {}),
      skills: skills.filter((row) => row.agentId === agent.id).length,
      tools: tools.filter((row) => row.agentId === agent.id).length,
      customSoul: policy.files?.some((file) => file.path === 'SOUL.md') ?? false,
      projectedSoul: true,
      sourceTemplateId: agent.sourceTemplateId,
    };
  });
  if (apply && changes.length)
    await applyMatrix({ expectedRevision: state.revision, agents: changes });
  const sync = apply ? await modelProjectionDrift() : [];
  for (const id of sync) await syncAgentModel(id);
  const after = apply
    ? audit.map((entry) => {
        const change = changes.find((item) => item.agentId === entry.id);
        return change ? { ...entry, currentRole: change.role, own: [...entry.own, 'role'] } : entry;
      })
    : audit;
  return {
    applied: apply && (changes.length > 0 || sync.length > 0),
    agents: audit,
    after,
    projectionDrift: drift,
    synced: sync.length,
    preview,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply'))
    throw new Error('Usage: bun model-schema-migrate.ts [--apply]');
  console.log(JSON.stringify(await modelSchemaMigration(args.includes('--apply')), null, 2));
}
