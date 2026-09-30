import { eq } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { runVolitionScript } from '../../../../scripts/volition-script-runtime';
import type { TemplateFieldGroup } from '../modules/agents/core/template-sync';

import { MODEL_TEMPLATES } from '../modules/model-schemas/templates';
import { inferModelRole } from '../modules/model-schemas/roles';
export { inferModelRole } from '../modules/model-schemas/roles';

export async function modelSchemaMigration(apply = false, progress = (_message: string) => {}) {
  const {
    aiAgent,
    appSetting,
    agentChatCatalog,
    helenaModelAvailability,
    helenaModelPrice,
    agentMcpServerLink,
    agentSkillLink,
    agentToolLink,
    db,
    organizationAgentAssignment,
  } = await import('@repo/db');
  progress('Loading model schema services.');
  const { normalizeAgentEscalation } = await import('../modules/agents/core/service');
  const { migrateEscalationValue, migrateSchemaEscalations } =
    await import('../modules/model-schemas/migration');
  const { migrateCloudModels, cloudAgentUpgrades, cloudModelAudit } =
    await import('../modules/model-schemas/cloud-model-migration');
  const { resetCopyToTemplate } = await import('../modules/agents/core/template-sync');
  const {
    applyMatrix,
    modelProjectionDrift,
    modelMatrix,
    previewMatrix,
    readModelState,
    syncAgentModel,
  } = await import('../modules/model-schemas/service');
  const { readEscalation, writeEscalation } = await import('../modules/escalation/service');
  progress('Reading model schemas, agents and template links.');
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
  const currentEscalation = await readEscalation();
  const globalEscalation = {
    ...currentEscalation,
    enabled: true,
    defaultModel:
      currentEscalation.defaultModel === 'gpt-6-sol'
        ? 'gpt-6.1-sol'
        : currentEscalation.defaultModel,
    failure: {
      ...currentEscalation.failure,
      enabled: true,
      localAttempts: 2,
      on: ['tests-failed', 'loop', 'timeout', 'error'] as (
        'tests-failed' | 'loop' | 'timeout' | 'error'
      )[],
    },
    ...(state.active === 'nur-lokal' && {
      kinds: currentEscalation.kinds.map((kind) => ({ ...kind, enabled: false })),
      uncertainty: { ...currentEscalation.uncertainty, enabled: false },
    }),
  };
  const globalEscalationMigration = !isDeepStrictEqual(currentEscalation, globalEscalation);
  const [catalogs, availability, priceRows] = await Promise.all([
    db
      .select({ agentId: agentChatCatalog.agentId, models: agentChatCatalog.models })
      .from(agentChatCatalog),
    db
      .select({
        runtime: helenaModelAvailability.runtime,
        model: helenaModelAvailability.model,
        state: helenaModelAvailability.state,
      })
      .from(helenaModelAvailability),
    db.select({ model: helenaModelPrice.model }).from(helenaModelPrice),
  ]);
  const cloudAudit = cloudModelAudit(
    catalogs.map((entry) => {
      const policy = agents.find((agent) => agent.id === entry.agentId)?.policy as {
        runtime?: string;
      } | null;
      return {
        runtime: policy?.runtime ?? 'hermes',
        models: Array.isArray(entry.models) ? (entry.models as { id: string }[]) : [],
      };
    }),
    availability,
    priceRows,
  );
  const [stored] = await db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, 'volition.modelSchemas'));
  const schemaEscalationMigration = Boolean(
    stored?.value &&
    !isDeepStrictEqual(stored.value, migrateSchemaEscalations(stored.value as typeof state)),
  );
  const cloud = migrateCloudModels(state.schemas);
  const cloudSchemas = [...new Set(cloud.changes.map((change) => change.schema))].map(
    (id) => cloud.schemas[id]!,
  );
  const cloudUpgrades = cloudAgentUpgrades(
    agents,
    matrix.agents.map((row) => ({ id: row.id, schema: row.schemaId, role: row.role })),
    cloud.changes,
  );
  const changes = agents.flatMap((agent) => {
    const assignment = assignments.find((item) => item.agentId === agent.id);
    const role = inferModelRole(agent, assignment);
    const policy = agent.policy as { escalation?: unknown } | null;
    const raw = agent.overrides.escalation;
    const inheritedLocalDefault =
      matrix.agents.find((row) => row.id === agent.id)?.schemaId === 'nur-lokal' &&
      isDeepStrictEqual(
        policy?.escalation,
        MODEL_TEMPLATES['nur-lokal']!.roles.general!.escalation,
      );
    const escalation =
      raw != null
        ? migrateEscalationValue(raw, policy?.escalation)
        : policy?.escalation &&
            !inheritedLocalDefault &&
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
  progress('Computing model migration preview.');
  const preview = await previewMatrix({
    expectedRevision: state.revision,
    agents: changes,
    schemas: cloudSchemas,
  });
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
  if (apply) progress('Applying model schema changes and template repairs.');
  if (apply && (changes.length || schemaEscalationMigration || cloudSchemas.length))
    await applyMatrix({ expectedRevision: state.revision, agents: changes, schemas: cloudSchemas });
  if (apply)
    for (const repair of templateRepairs)
      for (const group of repair.groups)
        await resetCopyToTemplate(repair.agentId, repair.teamId, group);
  if (apply && globalEscalationMigration) await writeEscalation(globalEscalation);
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
        cloudSchemas.length > 0 ||
        schemaEscalationMigration ||
        globalEscalationMigration ||
        sync.length > 0 ||
        templateRepairs.length > 0),
    agents: audit,
    after,
    cloudModelAudit: cloudAudit,
    cloudSchemaChanges: cloud.changes,
    cloudAgentUpgrades: cloudUpgrades,
    schemaEscalationMigration,
    globalEscalationMigration,
    globalEscalation,
    missingToolProfiles: agents
      .filter(
        (agent) =>
          !(agent.policy as { helena?: { toolProfile?: string } } | null)?.helena?.toolProfile,
      )
      .map((agent) => agent.id),
    projectionDrift: drift,
    templateRepairs,
    synced: sync.length,
    preview,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  await runVolitionScript(
    'model-schema-migrate',
    args.includes('--apply'),
    async ({ progress, onClose }) => {
      if (args.some((arg) => arg !== '--apply'))
        throw new Error('Usage: bun model-schema-migrate.ts [--apply]');
      progress('Loading database modules.');
      const { closeDatabase } = await import('@repo/db');
      onClose(closeDatabase);
      console.log(
        JSON.stringify(await modelSchemaMigration(args.includes('--apply'), progress), null, 2),
      );
    },
  );
}
