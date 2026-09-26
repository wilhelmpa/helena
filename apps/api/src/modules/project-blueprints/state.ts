import { existsSync } from 'node:fs';
import {
  agentMcpServer,
  agentMcpServerLink,
  agentSkill,
  agentSkillLink,
  agentTool,
  agentToolLink,
  aiAgent,
  db,
  helenaSchedule,
  integrationCredential,
  noteBoard,
  organizationAgentAssignment,
  organizationDepartment,
  organizationGoal,
  organizationProjectAssignment,
  project,
  projectMember,
  projectSetting,
  teamMember,
} from '@repo/db';
import { absoluteVaultPath } from '@repo/vault';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ProjectBlueprint } from '@helena/sdk';
import { registries } from '#shared/helena';
import { normalizeRuntimePolicy } from '#modules/agents/core/service';
import { BROWSER_GATEWAY_MCP_SERVER_NAME } from '#modules/agents/mcp-servers/service';
import { getAgentNetwork } from '#modules/agent-egress/service';
import { listViewFolders } from '#modules/views/service';
import { hermesProjectCoordinatorInstructions } from '#modules/projects/service';
import { projectFilePath, templateFilePath, type BlueprintState, type StateAgent } from './plan';

// What a project blueprint is planned against: the team's rows, read only.

// The team of the Home agent (@master), or the one named.
export async function blueprintTeam(teamId?: number): Promise<number> {
  if (teamId !== undefined) return teamId;
  const rows = await db
    .select({ teamId: aiAgent.teamId })
    .from(aiAgent)
    .where(eq(aiAgent.username, 'master'));
  if (rows.length !== 1) throw new Error('Name the team with --team <id>.');
  return rows[0]!.teamId;
}

export async function teamOwner(teamId: number): Promise<string> {
  const [owner] = await db
    .select({ userId: teamMember.userId })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.role, 'owner')))
    .limit(1);
  if (!owner) throw new Error(`Team ${teamId} has no owner.`);
  return owner.userId;
}

export async function loadBlueprintState(
  teamId: number,
  blueprint: ProjectBlueprint,
): Promise<BlueprintState> {
  const key = blueprint.project.key;
  const [projectRow] = await db
    .select({
      id: project.id,
      key: project.key,
      name: project.name,
      departmentId: organizationProjectAssignment.departmentId,
      instructions: organizationProjectAssignment.instructions,
    })
    .from(project)
    .leftJoin(
      organizationProjectAssignment,
      and(
        eq(organizationProjectAssignment.projectId, project.id),
        eq(organizationProjectAssignment.teamId, teamId),
      ),
    )
    .where(and(eq(project.teamId, teamId), eq(project.key, key)));
  const projectId = projectRow?.id ?? null;

  const connectors = [
    ...new Set(blueprint.agents.flatMap((agent) => (agent.tools ?? []).map((t) => t.connector))),
  ];

  const [
    departments,
    agents,
    skillLinks,
    library,
    memberships,
    assignments,
    browserLinks,
    toolLinks,
    goals,
    routines,
    boards,
    credentials,
    agentTools,
    networkRow,
  ] = await Promise.all([
    db
      .select({ id: organizationDepartment.id, name: organizationDepartment.name })
      .from(organizationDepartment)
      .where(eq(organizationDepartment.teamId, teamId)),
    db
      .select({
        id: aiAgent.id,
        userId: aiAgent.userId,
        username: aiAgent.username,
        template: aiAgent.template,
        sourceTemplateId: aiAgent.sourceTemplateId,
        instructions: aiAgent.instructions,
        runtimePolicy: aiAgent.runtimePolicy,
      })
      .from(aiAgent)
      .where(eq(aiAgent.teamId, teamId)),
    db
      .select({ agentId: agentSkillLink.agentId, name: agentSkill.name })
      .from(agentSkillLink)
      .innerJoin(agentSkill, eq(agentSkill.id, agentSkillLink.skillId))
      .where(eq(agentSkill.teamId, teamId)),
    db.select({ name: agentSkill.name }).from(agentSkill).where(eq(agentSkill.teamId, teamId)),
    db
      .select({
        userId: projectMember.userId,
        key: project.key,
        projectId: project.id,
        description: projectMember.description,
      })
      .from(projectMember)
      .innerJoin(project, eq(project.id, projectMember.projectId))
      .where(eq(project.teamId, teamId)),
    db
      .select({
        agentId: organizationAgentAssignment.agentId,
        departmentId: organizationAgentAssignment.departmentId,
      })
      .from(organizationAgentAssignment)
      .where(eq(organizationAgentAssignment.teamId, teamId)),
    db
      .select({ agentId: agentMcpServerLink.agentId })
      .from(agentMcpServerLink)
      .innerJoin(agentMcpServer, eq(agentMcpServer.id, agentMcpServerLink.mcpServerId))
      .where(
        and(
          eq(agentMcpServer.teamId, teamId),
          eq(agentMcpServer.name, BROWSER_GATEWAY_MCP_SERVER_NAME),
        ),
      ),
    db
      .select({
        agentId: agentToolLink.agentId,
        agentToolId: agentTool.id,
        toolKey: agentTool.toolKey,
        credentialId: agentTool.credentialId,
      })
      .from(agentToolLink)
      .innerJoin(agentTool, eq(agentTool.id, agentToolLink.agentToolId))
      .where(eq(agentTool.teamId, teamId)),
    db
      .select({ title: organizationGoal.title, projectId: organizationGoal.projectId })
      .from(organizationGoal)
      .where(eq(organizationGoal.teamId, teamId)),
    projectId === null
      ? Promise.resolve([])
      : db
          .select({ scheduleKey: helenaSchedule.scheduleKey })
          .from(helenaSchedule)
          .where(eq(helenaSchedule.projectId, projectId)),
    projectId === null
      ? Promise.resolve([])
      : db
          .select({ name: noteBoard.name })
          .from(noteBoard)
          .where(and(eq(noteBoard.projectId, projectId), isNull(noteBoard.ownerUserId))),
    connectors.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: integrationCredential.id,
            kind: integrationCredential.integrationKey,
            label: integrationCredential.label,
          })
          .from(integrationCredential)
          .where(
            and(
              eq(integrationCredential.teamId, teamId),
              inArray(integrationCredential.integrationKey, connectors),
            ),
          ),
    db
      .select({
        id: agentTool.id,
        toolKey: agentTool.toolKey,
        credentialId: agentTool.credentialId,
      })
      .from(agentTool)
      .where(eq(agentTool.teamId, teamId)),
    projectId === null
      ? Promise.resolve([])
      : db
          .select({ key: projectSetting.key })
          .from(projectSetting)
          .where(
            and(eq(projectSetting.projectId, projectId), eq(projectSetting.key, 'agent_network')),
          ),
  ]);

  const stateAgents: StateAgent[] = agents.map((row) => {
    const policy = normalizeRuntimePolicy(row.runtimePolicy);
    const member = memberships.filter((m) => m.userId === row.userId);
    const here = projectId === null ? undefined : member.find((m) => m.projectId === projectId);
    return {
      id: row.id,
      userId: row.userId,
      username: row.username,
      template: row.template,
      sourceTemplateId: row.sourceTemplateId,
      instructions: row.instructions,
      skills: skillLinks.filter((link) => link.agentId === row.id).map((link) => link.name),
      projectKeys: member.map((m) => m.key),
      assignment: here ? (here.description ?? '') : null,
      departmentId: assignments.find((a) => a.agentId === row.id)?.departmentId ?? null,
      projectBrowser: browserLinks.some((link) => link.agentId === row.id),
      memoryApproval: policy.memoryApproval ?? false,
      tools: toolLinks
        .filter((link) => link.agentId === row.id)
        .map(({ agentToolId, toolKey, credentialId }) => ({ agentToolId, toolKey, credentialId })),
    };
  });

  const network = projectId === null ? null : await getAgentNetwork(projectId);
  const files = [
    ...blueprint.knowledge.project.map((file) => projectFilePath(key, file.path)),
    ...blueprint.knowledge.templates.map((file) => templateFilePath(file.path)),
  ];
  const connectorTools = Object.fromEntries(
    connectors.map((id) => [
      id,
      registries.tools
        .list()
        .filter((tool) => tool.connector === id)
        .map((tool) => tool.name),
    ]),
  );

  return {
    departments,
    project: projectRow
      ? {
          id: projectRow.id,
          key: projectRow.key,
          name: projectRow.name,
          departmentId: projectRow.departmentId ?? null,
          instructions: projectRow.instructions ?? '',
        }
      : null,
    areas:
      projectId === null
        ? []
        : (await listViewFolders(projectId)).map(({ name, folder }) => ({ name, folder })),
    agents: stateAgents,
    library: library.map((row) => row.name),
    network: network
      ? {
          stored: networkRow.length > 0,
          mode: network.mode,
          allow: network.allow,
          deny: network.deny,
          agents: network.agents,
        }
      : null,
    existingFiles: files.filter((path) => existsSync(absoluteVaultPath(path))),
    boards: boards.map((row) => row.name),
    goals,
    routineKeys: routines.map((row) => row.scheduleKey ?? '').filter(Boolean),
    credentials: credentials.map((row) => ({ ...row, label: row.label ?? row.kind })),
    agentTools,
    connectorTools,
    defaultCoordinatorInstructions: hermesProjectCoordinatorInstructions(
      key,
      blueprint.project.name,
    ),
  };
}
