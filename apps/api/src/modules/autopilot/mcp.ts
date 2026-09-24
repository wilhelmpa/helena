import { db, agentRun, aiAgent, issue, project } from '@repo/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { categoryFromAnnotations } from '@helena/policy';
import type { McpRouteTool } from '#mcp/generate';
import { decide, type EngineDecision } from './engine';

// Helena's own MCP tools ask the policy engine like every other tool: an agent calling one
// is checked here, on the server, before the call reaches its route. The category comes from
// what the tool declares (mcpTool's policy) or its MCP annotations; people are not checked.

async function callingAgent(userId: string): Promise<{ id: number; teamId: number } | null> {
  const [row] = await db
    .select({ id: aiAgent.id, teamId: aiAgent.teamId })
    .from(aiAgent)
    .where(eq(aiAgent.userId, userId));
  return row ?? null;
}

// The project a call acts in: the one it names, or the issue's.
async function projectOfCall(
  teamId: number,
  args: Record<string, unknown>,
): Promise<number | null> {
  if (typeof args.projectKey === 'string') {
    const [row] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.key, args.projectKey), eq(project.teamId, teamId)));
    if (row) return row.id;
  }
  const issueId = Number(args.issueId);
  if (Number.isInteger(issueId) && issueId > 0) {
    const [row] = await db
      .select({ projectId: issue.projectId })
      .from(issue)
      .where(eq(issue.id, issueId));
    if (row) return row.projectId;
  }
  return null;
}

// The run the call comes from: the agent's one claimed, unfinished run in the project.
async function runOfCall(agentId: number, projectId: number | null): Promise<number | null> {
  if (projectId == null) return null;
  const rows = await db
    .select({ id: agentRun.id })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.agentId, agentId),
        eq(agentRun.projectId, projectId),
        eq(agentRun.status, 'pending'),
        isNotNull(agentRun.startedAt),
      ),
    )
    .limit(2);
  return rows.length === 1 ? rows[0]!.id : null;
}

// Null when the call needs no decision: a person calls, or the tool only reads or reports.
export async function decideMcpCall(
  tool: Pick<McpRouteTool, 'name' | 'annotations' | 'category' | 'scope'>,
  args: Record<string, unknown>,
  callerUserId: string,
): Promise<EngineDecision | null> {
  const category = categoryFromAnnotations(tool.annotations, tool.category);
  if (category === 'read' || category === 'report') return null;
  const agent = await callingAgent(callerUserId);
  if (!agent) return null;
  const projectId = await projectOfCall(agent.teamId, args);
  return decide({
    adapter: 'mcp',
    agentId: agent.id,
    teamId: agent.teamId,
    projectId,
    runId: await runOfCall(agent.id, projectId),
    category,
    scope: tool.scope ?? (category === 'send' ? 'external' : 'workspace'),
    tool: tool.name,
    summary: `${tool.name} ${JSON.stringify(args).slice(0, 300)}`,
  });
}
