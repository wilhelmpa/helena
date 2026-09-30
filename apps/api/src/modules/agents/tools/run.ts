import { renderDisplayName } from '@helena/sdk';
import {
  consoleLogger,
  SchemaError,
  toCallToolResult,
  toolCategory,
  validate,
  type ActionCategory,
  type AgentRef,
  type AnyAgentTool,
  type CallerAuth,
  type ProjectRef,
} from '@helena/sdk';
import { getDisplayName } from '@repo/db';
import {
  aiAgent,
  agentTool,
  agentToolLink,
  db,
  integrationCredential,
  project,
  projectMember,
} from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { host, registries } from '#shared/helena';
import { assertAgentOfProject, HOME_SLUG, projectSlug } from '#shared/agent-socket';
import { emergencyStopActive } from '#modules/emergency-stop/service';
import { recordAgentUses } from '../credentials/delivery';
import { credentialInScope } from '../credentials/grants';
import { credentialValues } from '../integrations/service';
import { listAgentToolLinks } from './service';

// Configured tools at work (docs/helena-decisions/trading.md §5.2): a connector's tool that
// the owner bound to one of the team's credentials and enabled on an agent reaches that
// agent over Helena's MCP endpoint, under the same name as in the catalog. A call is asked
// through the policy host like every other tool, stops while Helena's emergency stop is on
// (reading aside), runs with the bound credential, which the agent never sees, and lands in
// the credential's audit log. An agent without the binding neither lists nor reaches it.

export interface ConfiguredTool {
  tool: AnyAgentTool;
  credentialId: number;
  label: string;
}

interface CallerAgent {
  id: number;
  teamId: number;
  userId: string;
  username: string;
  sourceTemplateId: number | null;
}

async function callerAgent(userId: string): Promise<CallerAgent | null> {
  const [row] = await db
    .select({
      id: aiAgent.id,
      teamId: aiAgent.teamId,
      userId: aiAgent.userId,
      username: aiAgent.username,
      sourceTemplateId: aiAgent.sourceTemplateId,
    })
    .from(aiAgent)
    .where(eq(aiAgent.userId, userId))
    .limit(1);
  return row ?? null;
}

// The configured tools enabled on the caller, by MCP name. A tool key enabled twice (two
// credentials) is served once, with the binding made first.
export async function configuredToolsOf(userId: string): Promise<Map<string, ConfiguredTool>> {
  const agent = await callerAgent(userId);
  const out = new Map<string, ConfiguredTool>();
  if (!agent) return out;
  const links = (await listAgentToolLinks(agent.id)).sort((a, b) => a.id - b.id);
  for (const link of links) {
    const tool = registries.tools.get(link.toolKey);
    if (!tool || tool.connector !== link.integrationKey || out.has(tool.name)) continue;
    out.set(tool.name, {
      tool,
      credentialId: link.credentialId,
      label: link.credentialLabel ?? link.integrationKey,
    });
  }
  return out;
}

// A project socket narrows the context. Unscoped multi-project chats have no execution project.
async function projectOfAgent(
  userId: string,
  socketProject?: string | null,
): Promise<ProjectRef | null> {
  const rows = await db
    .select({ id: project.id, key: project.key, teamId: project.teamId })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(eq(projectMember.userId, userId));
  if (socketProject && socketProject !== HOME_SLUG)
    return rows.find((row) => projectSlug(row.key) === socketProject) ?? null;
  return rows.length === 1 ? rows[0]! : null;
}

function refusal(status: number, text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    isError: true,
    structuredContent: { error: { status, message: text } },
  };
}

function summary(input: unknown): string {
  try {
    return JSON.stringify(input).slice(0, 300);
  } catch {
    return '';
  }
}

export async function callConfiguredTool(
  configured: ConfiguredTool,
  args: Record<string, unknown>,
  caller: { userId: string; auth: CallerAuth; runId: number | null; agentProject?: string | null },
) {
  const agent = await callerAgent(caller.userId);
  if (!agent) return refusal(403, 'Only an agent uses configured tools.');
  // Home is an unscoped tool context, not a project socket membership. The binding
  // and project-limited credential checks below still require explicit membership.
  if (caller.agentProject && caller.agentProject !== HOME_SLUG) {
    try {
      await assertAgentOfProject(caller.userId, caller.agentProject);
    } catch {
      return refusal(403, 'The agent is no longer available in this project.');
    }
  }
  const { tool } = configured;
  const audit = (action: 'called' | 'denied', category: ActionCategory, purpose: string) =>
    recordAgentUses(agent, { runId: caller.runId, chatMessageId: null }, action, [
      { credentialId: configured.credentialId, label: configured.label, purpose, category },
    ]);

  let input: unknown;
  try {
    input = await validate(tool.inputSchema, args);
  } catch (error) {
    return refusal(400, error instanceof SchemaError ? error.message : String(error));
  }
  const category = toolCategory(tool, input);
  const agentRef: AgentRef = {
    id: agent.id,
    userId: agent.userId,
    name: agent.username,
    templateId: agent.sourceTemplateId,
  };
  const projectRef = await projectOfAgent(agent.userId, caller.agentProject);
  if (caller.agentProject && caller.agentProject !== HOME_SLUG && !projectRef)
    return refusal(403, 'The agent is no longer available in this project.');

  if (category !== 'read' && (await emergencyStopActive())) {
    await audit('denied', category, `${tool.name}: emergency stop`);
    return refusal(503, `Not now: ${await getDisplayName()}'s emergency stop (Not-Aus) is on.`);
  }
  if (registries.policies.list().length > 0) {
    const decision = await host.decide({
      agent: agentRef,
      project: projectRef,
      action: category,
      context: {
        tool: tool.name,
        connector: tool.connector,
        input,
        runId: caller.runId,
        scope: 'external',
      },
    });
    if (decision.effect === 'deny') {
      await audit('denied', category, `${tool.name}: ${decision.reason}`);
      return refusal(403, `Not allowed: ${decision.reason}`);
    }
    if (decision.effect === 'needs-approval') {
      await audit('denied', category, `${tool.name}: waits for approval`);
      return refusal(
        403,
        `This needs approval: ${decision.reason}. Call request_approval with what you want to ` +
          'do and wait for the decision before you try again.',
      );
    }
  }

  // MCP can retain the catalog after the owner revokes a binding or changes its scope.
  const currentProject = await projectOfAgent(agent.userId, caller.agentProject);
  if (currentProject?.id !== projectRef?.id || currentProject?.teamId !== projectRef?.teamId)
    return refusal(403, 'The configured tool project changed; start a new request.');
  const [binding] = await db
    .select({ id: agentTool.id })
    .from(agentToolLink)
    .innerJoin(aiAgent, eq(aiAgent.id, agentToolLink.agentId))
    .innerJoin(agentTool, eq(agentTool.id, agentToolLink.agentToolId))
    .innerJoin(integrationCredential, eq(integrationCredential.id, agentTool.credentialId))
    .where(
      and(
        eq(aiAgent.id, agent.id),
        eq(aiAgent.userId, caller.userId),
        eq(aiAgent.teamId, agent.teamId),
        eq(agentTool.teamId, agent.teamId),
        eq(agentTool.toolKey, tool.name),
        eq(integrationCredential.id, configured.credentialId),
        eq(integrationCredential.teamId, agent.teamId),
        eq(integrationCredential.integrationKey, tool.connector!),
        credentialInScope({
          agentId: agent.id,
          userId: agent.userId,
          projectId: currentProject?.id ?? null,
        }),
      ),
    )
    .limit(1);
  if (!binding) return refusal(403, 'The configured tool binding is no longer available here.');

  const credential = await credentialValues(configured.credentialId, agent.teamId);
  if (!credential) {
    await audit('denied', category, `${tool.name}: the credential is gone`);
    return refusal(404, 'The credential this tool is bound to no longer exists.');
  }
  try {
    const result = await tool.handler(input, {
      displayName: await getDisplayName(),
      agent: agentRef,
      project: projectRef,
      credential,
      credentialId: configured.credentialId,
      runId: caller.runId,
      caller: { userId: caller.userId, auth: caller.auth },
      log: consoleLogger(`tool ${tool.name}`),
    });
    const called = toCallToolResult(result);
    await audit(
      'called',
      category,
      `${tool.name}${called.isError ? ' (refused)' : ''}: ${summary(input)}`,
    );
    return called;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await audit('called', category, `${tool.name} failed: ${message}`);
    return refusal(502, renderDisplayName(message.slice(0, 500), await getDisplayName()));
  }
}
