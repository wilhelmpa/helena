import { eq } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { normalizeAgentEscalation } from '../modules/agents/core/service';
import {
  migrateEscalationValue,
  migrateSchemaEscalations,
} from '../modules/model-schemas/migration';
import {
  aiAgent,
  appSetting,
  agentMcpServerLink,
  agentSkillLink,
  agentToolLink,
  db,
  organizationAgentAssignment,
} from '@repo/db';
import { resetCopyToTemplate, type TemplateFieldGroup } from '../modules/agents/core/template-sync';
import { MODEL_ROLES } from '../modules/model-schemas/templates';
import {
  applyMatrix,
  modelProjectionDrift,
  modelMatrix,
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
  const [state, agents, assignments, skills, tools, mcpServers, drift, matrix] = await Promise.all([
    readModelState(),
    db
      .select({
        id: aiAgent.id,
        teamId: aiAgent.teamId,
        username: aiAgent.username,
        agentRole: aiAgent.agentRole,
        role: aiAgent.modelRole,
        overrides: aiAgent.modelOverrides,
        templateOverrides: aiAgent.templateOverrides,
        model: aiAgent.model,
        instructions: aiAgent.instructions,
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
    db.select({ agentId: agentSkillLink.agentId, id: agentSkillLink.skillId }).from(agentSkillLink),
    db
      .select({ agentId: agentToolLink.agentId, id: agentToolLink.agentToolId })
      .from(agentToolLink),
    db
      .select({ agentId: agentMcpServerLink.agentId, id: agentMcpServerLink.mcpServerId })
      .from(agentMcpServerLink),
    modelProjectionDrift(),
    modelMatrix(),
  ]);
  const [stored] = await db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, 'volition.modelSchemas'));
  const schemaEscalationMigration = Boolean(
    stored?.value &&
    !isDeepStrictEqual(stored.value, migrateSchemaEscalations(stored.value as typeof state)),
  );
  const changes = agents.flatMap((agent) => {
    const assignment = assignments.find((item) => item.agentId === agent.id);
    const role = inferModelRole(agent, assignment);
    const policy = agent.policy as { escalation?: unknown } | null;
    const raw = agent.overrides.escalation;
    const escalation =
      raw != null
        ? migrateEscalationValue(raw, policy?.escalation)
        : policy?.escalation &&
            !isDeepStrictEqual(
              normalizeAgentEscalation(policy.escalation),
              matrix.agents.find((row) => row.id === agent.id)?.cells.escalation.value ??
                state.schemas[state.active]?.roles[agent.role]?.escalation,
            )
          ? normalizeAgentEscalation(policy.escalation)
          : undefined;
    const values = escalation && !isDeepStrictEqual(raw, escalation) ? { escalation } : {};
    const roleChange = role !== agent.role && agent.overrides.role === undefined;
    return roleChange || Object.keys(values).length
      ? [{ agentId: agent.id, ...(roleChange && { role }), values }]
      : [];
  });
  const preview = await previewMatrix({ expectedRevision: state.revision, agents: changes });
  const sameIds = (items: { agentId: number; id: number }[], left: number, right: number) =>
    JSON.stringify(
      items
        .filter((item) => item.agentId === left)
        .map((item) => item.id)
        .sort(),
    ) ===
    JSON.stringify(
      items
        .filter((item) => item.agentId === right)
        .map((item) => item.id)
        .sort(),
    );
  const templateRepairs = agents.flatMap((agent) => {
    const source = agents.find((item) => item.id === agent.sourceTemplateId);
    if (!source) return [];
    const own = new Set(agent.templateOverrides ?? []);
    const groups: TemplateFieldGroup[] = [];
    if (!own.has('skills') && !sameIds(skills, agent.id, source.id)) groups.push('skills');
    if (!own.has('tools') && !sameIds(tools, agent.id, source.id)) groups.push('tools');
    if (!own.has('mcpServers') && !sameIds(mcpServers, agent.id, source.id))
      groups.push('mcpServers');
    if (!own.has('instructions') && agent.instructions !== source.instructions)
      groups.push('instructions');
    return groups.length ? [{ agentId: agent.id, teamId: agent.teamId, groups }] : [];
  });
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
      mcpServers: mcpServers.filter((row) => row.agentId === agent.id).length,
      customInstructions: Boolean(agent.instructions),
      customSoul: policy.files?.some((file) => file.path === 'SOUL.md') ?? false,
      projectedSoul: true,
      sourceTemplateId: agent.sourceTemplateId,
    };
  });
  if (apply && (changes.length || schemaEscalationMigration))
    await applyMatrix({ expectedRevision: state.revision, agents: changes });
  if (apply)
    for (const repair of templateRepairs)
      for (const group of repair.groups)
        await resetCopyToTemplate(repair.agentId, repair.teamId, group);
  const sync = apply ? await modelProjectionDrift() : [];
  for (const id of sync) await syncAgentModel(id);
  const [skillsAfter, toolsAfter, mcpAfter, instructionsAfter] = apply
    ? await Promise.all([
        db.select({ agentId: agentSkillLink.agentId }).from(agentSkillLink),
        db.select({ agentId: agentToolLink.agentId }).from(agentToolLink),
        db.select({ agentId: agentMcpServerLink.agentId }).from(agentMcpServerLink),
        db.select({ id: aiAgent.id, instructions: aiAgent.instructions }).from(aiAgent),
      ])
    : [
        skills,
        tools,
        mcpServers,
        agents.map((agent) => ({ id: agent.id, instructions: agent.instructions })),
      ];
  const after = apply
    ? audit.map((entry) => {
        const change = changes.find((item) => item.agentId === entry.id);
        return {
          ...entry,
          currentRole: change?.role ?? entry.currentRole,
          own: change
            ? [
                ...new Set([
                  ...entry.own,
                  ...Object.keys(change.values),
                  ...(change.role ? ['role'] : []),
                ]),
              ]
            : entry.own,
          skills: skillsAfter.filter((row) => row.agentId === entry.id).length,
          tools: toolsAfter.filter((row) => row.agentId === entry.id).length,
          mcpServers: mcpAfter.filter((row) => row.agentId === entry.id).length,
          customInstructions: Boolean(
            instructionsAfter.find((row) => row.id === entry.id)?.instructions,
          ),
        };
      })
    : audit;
  return {
    applied:
      apply &&
      (changes.length > 0 ||
        schemaEscalationMigration ||
        sync.length > 0 ||
        templateRepairs.length > 0),
    agents: audit,
    after,
    schemaEscalationMigration,
    projectionDrift: drift,
    templateRepairs,
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
