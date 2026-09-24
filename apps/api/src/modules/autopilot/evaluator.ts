import { db, agentRun, issue } from '@repo/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import {
  isActionCategory,
  type ActionScope,
  type PolicyDecision,
  type PolicyEvaluator,
  type PolicyRequest,
} from '@helena/sdk';
import type { AutopilotLevel } from '@helena/policy';
import { decide, levelName, type EngineDecision, type PolicyAdapter } from './engine';

// The Autopilot as a policy evaluator of @helena/sdk (packages/sdk/src/policy.ts). It is
// registered as the built-in plugin helena.autopilot (modules/plugins/builtin.ts), so it
// answers for every caller the framework routes through its policy host: Helena's own MCP
// tools, plugin tools, connector services, workflow steps. The runtimes (Hermes, Claude
// Code), the browser gateway and approval requests ask the engine directly (engine.ts).

export const AUTOPILOT_EVALUATOR_ID = 'helena-autopilot';

// A sentence a person reads on the approval card or in the run log.
export function decisionSentence(decision: EngineDecision): string {
  const level = levelName(decision.level as AutopilotLevel);
  switch (decision.reason) {
    case 'always-allowed':
      return 'Reading and reporting are always allowed';
    case 'approved':
      return 'A person approved exactly this';
    case 'level-allows':
      return `Autopilot level ${level} allows ${decision.category}`;
    case 'hard-block':
      return `A person always approves ${decision.category}, even at level 3`;
    case 'budget-exhausted':
      return 'A budget of the agent or the project is used up';
    case 'policy':
      return decision.detail ?? 'A policy asks for it';
    default:
      return `Autopilot level ${level} asks a person before ${decision.category}`;
  }
}

// The project a call acts in when the caller named none: the task's.
async function projectOfInput(input: unknown): Promise<number | null> {
  const issueId = Number((input as { issueId?: unknown } | null | undefined)?.issueId);
  if (!Number.isInteger(issueId) || issueId <= 0) return null;
  const [row] = await db
    .select({ projectId: issue.projectId })
    .from(issue)
    .where(eq(issue.id, issueId));
  return row?.projectId ?? null;
}

// The run a call comes from: the one the caller names when it is the agent's, otherwise the
// agent's one claimed, unfinished run in the project.
async function runOfCall(
  agentId: number,
  projectId: number | null,
  named: number | null | undefined,
): Promise<number | null> {
  if (named != null) {
    const [run] = await db
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(and(eq(agentRun.id, named), eq(agentRun.agentId, agentId)));
    if (run) return run.id;
  }
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

// Where the call lands: what the caller says, else outside the agent's workspace for a
// delete or an execute (a connector's or a plugin's reaches beyond Helena).
function scopeOf(request: PolicyRequest): ActionScope {
  const said =
    request.context.scope ??
    (request.context.input as { scope?: unknown } | undefined)?.scope ??
    null;
  if (said === 'workspace' || said === 'external') return said;
  return request.action === 'delete' || request.action === 'execute' ? 'external' : 'workspace';
}

function adapterOf(request: PolicyRequest): PolicyAdapter {
  const { connector, runtime, stepType, tool } = request.context;
  if (connector) return 'connector';
  if (runtime) return runtime;
  if (stepType) return 'workflow';
  return tool ? 'mcp' : 'sdk';
}

export const autopilotPolicyEvaluator: PolicyEvaluator = {
  id: AUTOPILOT_EVALUATOR_ID,
  async evaluate(request): Promise<PolicyDecision | null> {
    // An action outside the Autopilot's categories is not its question.
    if (!isActionCategory(request.action)) return null;
    // A person acting is decided by permissions, not by the Autopilot.
    if (!request.agent) return null;
    // Reading and reporting are always allowed, at every level and on a used-up budget.
    if (request.action === 'read' || request.action === 'report') {
      return {
        effect: 'allow',
        reason: 'Reading and reporting are always allowed',
        evaluator: AUTOPILOT_EVALUATOR_ID,
      };
    }
    const context = request.context ?? {};
    const projectId = request.project?.id ?? (await projectOfInput(context.input));
    const decision = await decide({
      adapter: adapterOf(request),
      agentId: request.agent.id,
      teamId: request.project?.teamId ?? null,
      projectId,
      runId: await runOfCall(request.agent.id, projectId, context.runId),
      category: request.action,
      scope: scopeOf(request),
      tool: context.tool ?? context.service ?? context.stepType ?? null,
      summary:
        context.target ??
        (context.tool && context.input !== undefined
          ? `${context.tool} ${JSON.stringify(context.input).slice(0, 300)}`
          : null),
      command: context.runtime ? (context.target ?? null) : null,
    });
    return {
      effect: decision.outcome,
      reason: decisionSentence(decision),
      evaluator: AUTOPILOT_EVALUATOR_ID,
    };
  },
};
