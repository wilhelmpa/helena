import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { Elysia, t } from 'elysia';
import { and, eq } from 'drizzle-orm';
import {
  agentMcpServer,
  agentMcpServerLink,
  agentSkill,
  agentSkillLink,
  agentTool,
  agentToolLink,
  aiAgent,
  db,
  helenaBudget,
  organizationAgentAssignment,
  organizationDepartment,
  project,
  projectMember,
} from '@repo/db';
import {
  absoluteVaultPath,
  assertNoSymlink,
  commitVaultPaths,
  composeNote,
  indexVaultPaths,
  PLAN_AUTHOR,
  readVaultFile,
  splitNote,
  VaultError,
  walkVault,
  writeVaultFile,
} from '@repo/vault';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { HttpError } from '#shared/lib';
import { commonErrors } from '#shared/responses';
import { reindexVaultItems } from '#modules/knowledge/service';

type Agent = typeof aiAgent.$inferSelect;

interface AgentCatalog {
  skills: string[];
  tools: string[];
  mcpServers: string[];
  budgets: Array<{ metric: string; period: string; limit: number }>;
  organization: {
    department: string | null;
    reportsToAgentId: number | null;
    roleTitle: string | null;
    role: string | null;
    capabilities: string[];
  };
}

export function agentExportNote(
  agent: Agent,
  projectKey: string,
  exportedAt: string,
  catalog: AgentCatalog,
) {
  // The revision covers only exported non-secret fields; runtime status and raw
  // instructions never enter the snapshot or its hash.
  const fields = {
    agent_id: agent.id,
    username: agent.username,
    role: agent.agentRole,
    model: agent.model,
    heartbeat_minutes: agent.heartbeatIntervalMinutes,
    heartbeat_days: agent.heartbeatDays,
    heartbeat_timezone: agent.heartbeatTimezone,
    autopilot_level: agent.autopilotLevel,
    project_scope: agent.projectScope,
    skills: catalog.skills,
    tools: catalog.tools,
    mcp_servers: catalog.mcpServers,
    budgets: catalog.budgets,
    department: catalog.organization.department,
    reports_to_agent_id: catalog.organization.reportsToAgentId,
    role_title: catalog.organization.roleTitle,
    organization_role: catalog.organization.role,
    capabilities: catalog.organization.capabilities,
  };
  const revision = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  const properties = {
    type: 'agent',
    schema_version: 1,
    generated: true,
    origin: 'system',
    project: projectKey,
    ...fields,
    revision,
    exported_at: exportedAt,
  };
  const body = `# ${agent.username}\n\nRead-only export of the agent configuration.\n`;
  const projectionHash = createHash('sha256')
    .update(composeNote(properties, body, null))
    .digest('hex');
  return {
    path: `Projects/${projectKey}/Docs/Agenten/${agent.id}.md`,
    content: composeNote({ ...properties, projection_hash: projectionHash }, body, null),
  };
}

async function existingFile(relative: string) {
  try {
    const file = await readVaultFile(relative, 2 * 1024 * 1024);
    return { content: file.bytes.toString('utf8'), sha256: file.sha256 };
  } catch (error) {
    if (error instanceof VaultError && error.status === 404) return null;
    throw error;
  }
}

function safeSnapshot(content: string): boolean {
  const note = splitNote(content);
  if (note.frontmatter.type !== 'agent' || note.frontmatter.generated !== true) return false;
  const { projection_hash: expected, ...properties } = note.frontmatter;
  return (
    typeof expected === 'string' &&
    createHash('sha256')
      .update(composeNote(properties, note.body, null))
      .digest('hex') === expected
  );
}

export async function materializeAgentExport(projectId: number, projectKey: string) {
  const snapshot = await exportAgentNotes(projectId, projectKey);
  const root = `Projects/${projectKey}/Docs/Agenten`;
  const desired = new Map(snapshot.notes.map((note) => [note.path, note.content]));
  const changed: string[] = [];
  for (const relative of await walkVault(root)) {
    if (!/\/\d+\.md$/.test(relative) || desired.has(relative)) continue;
    const file = await existingFile(relative);
    if (!file) continue;
    const frontmatter = splitNote(file.content).frontmatter;
    if (frontmatter.generated !== true || frontmatter.type !== 'agent') continue;
    if (!safeSnapshot(file.content))
      throw new HttpError(409, `Externally edited agent export: ${relative}`);
    await assertNoSymlink(relative);
    await rm(absoluteVaultPath(relative));
    changed.push(relative);
  }
  for (const [relative, content] of desired) {
    const file = await existingFile(relative);
    if (file) {
      if (!safeSnapshot(file.content))
        throw new HttpError(409, `Externally edited agent export: ${relative}`);
      const before = splitNote(file.content).frontmatter.revision;
      const after = splitNote(content).frontmatter.revision;
      if (before === after) continue;
    }
    await writeVaultFile(relative, Buffer.from(content), file?.sha256 ?? null);
    changed.push(relative);
  }
  if (!(await existingFile(snapshot.base.path))) {
    await writeVaultFile(snapshot.base.path, Buffer.from(snapshot.base.content), null);
    changed.push(snapshot.base.path);
  }
  if (changed.length) {
    await indexVaultPaths(changed, { author: 'system:agent-export' });
    await commitVaultPaths(changed, `Update agent export for ${projectKey}`, PLAN_AUTHOR);
    await reindexVaultItems(changed);
  }
  return {
    projectKey,
    basePath: snapshot.base.path,
    notes: snapshot.notes.map((note) => note.path),
    changed: changed.length,
  };
}

export async function exportAgentNotes(projectId: number, projectKey: string) {
  const agents = await db
    .select({ agent: aiAgent })
    .from(aiAgent)
    .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(
      and(
        eq(projectMember.projectId, projectId),
        eq(aiAgent.teamId, project.teamId),
        eq(aiAgent.template, false),
      ),
    )
    .orderBy(aiAgent.id);
  const exportedAt = new Date().toISOString();
  const root = `Projects/${projectKey}/Docs/Agenten`;
  const notes = await Promise.all(
    agents.map(async ({ agent }) => {
      const [skills, tools, servers, budgets, assignments] = await Promise.all([
        db
          .select({ name: agentSkill.name })
          .from(agentSkillLink)
          .innerJoin(
            agentSkill,
            and(eq(agentSkill.id, agentSkillLink.skillId), eq(agentSkill.teamId, agent.teamId)),
          )
          .where(eq(agentSkillLink.agentId, agent.id)),
        db
          .select({ name: agentTool.toolKey })
          .from(agentToolLink)
          .innerJoin(
            agentTool,
            and(eq(agentTool.id, agentToolLink.agentToolId), eq(agentTool.teamId, agent.teamId)),
          )
          .where(eq(agentToolLink.agentId, agent.id)),
        db
          .select({ name: agentMcpServer.name })
          .from(agentMcpServerLink)
          .innerJoin(
            agentMcpServer,
            and(
              eq(agentMcpServer.id, agentMcpServerLink.mcpServerId),
              eq(agentMcpServer.teamId, agent.teamId),
            ),
          )
          .where(eq(agentMcpServerLink.agentId, agent.id)),
        db
          .select({
            metric: helenaBudget.metric,
            period: helenaBudget.period,
            limit: helenaBudget.limitValue,
          })
          .from(helenaBudget)
          .where(and(eq(helenaBudget.agentId, agent.id), eq(helenaBudget.teamId, agent.teamId))),
        db
          .select({
            assignment: organizationAgentAssignment,
            department: organizationDepartment.name,
          })
          .from(organizationAgentAssignment)
          .leftJoin(
            organizationDepartment,
            eq(organizationDepartment.id, organizationAgentAssignment.departmentId),
          )
          .where(
            and(
              eq(organizationAgentAssignment.agentId, agent.id),
              eq(organizationAgentAssignment.teamId, agent.teamId),
            ),
          ),
      ]);
      return agentExportNote(agent, projectKey, exportedAt, {
        skills: skills.map((row) => row.name).sort(),
        tools: tools.map((row) => row.name).sort(),
        mcpServers: servers.map((row) => row.name).sort(),
        budgets: budgets.sort((a, b) =>
          `${a.metric}:${a.period}`.localeCompare(`${b.metric}:${b.period}`),
        ),
        organization: {
          department: assignments[0]?.department ?? null,
          reportsToAgentId: assignments[0]?.assignment.reportsToAgentId ?? null,
          roleTitle: assignments[0]?.assignment.roleTitle ?? null,
          role: assignments[0]?.assignment.role ?? null,
          capabilities: assignments[0]?.assignment.capabilities ?? [],
        },
      });
    }),
  );
  return {
    projectKey,
    generatedAt: exportedAt,
    notes,
    base: {
      path: `${root}/Agenten.base`,
      content: `filters:\n  and:\n    - 'file.inFolder("${root}")'\n    - 'note.type == "agent"'\nviews:\n  - type: table\n    name: Agenten\n    order:\n      - file.name\n      - note.agent_id\n      - note.role\n      - note.model\n      - note.heartbeat_minutes\n      - note.skills\n      - note.tools\n      - note.department\n      - note.reports_to_agent_id\n`,
    },
  };
}

export const agentExportRoutes = new Elysia({
  name: 'agent-export',
  detail: { tags: ['AI Agents'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/projects/:projectKey/agent-export',
    ({ project }) => exportAgentNotes(project.id, project.key),
    {
      projectAdmin: true,
      response: {
        200: t.Object({
          projectKey: t.String(),
          generatedAt: t.String(),
          notes: t.Array(t.Object({ path: t.String(), content: t.String() })),
          base: t.Object({ path: t.String(), content: t.String() }),
        }),
        ...commonErrors,
      },
      detail: {
        summary: 'Export redacted agent Markdown notes and Agenten.base',
        description:
          'Read-only DB snapshot. Raw instructions, runtime state and secrets are excluded. No file is written and importing the notes has no effect.',
      },
    },
  )
  .post(
    '/projects/:projectKey/agent-export/materialize',
    ({ project }) => materializeAgentExport(project.id, project.key),
    {
      projectAdmin: true,
      response: {
        200: t.Object({
          projectKey: t.String(),
          basePath: t.String(),
          notes: t.Array(t.String()),
          changed: t.Number(),
        }),
        ...commonErrors,
      },
      detail: {
        summary: 'Write redacted agent snapshots to the project vault',
        description: 'DB stays authoritative; existing edited snapshots cause 409.',
      },
    },
  );
