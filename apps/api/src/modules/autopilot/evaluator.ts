import { isActionCategory, type ActionScope, type AutopilotLevel } from '@helena/policy';
import { decide, levelName, type EngineDecision } from './engine';

// The Autopilot as a policy evaluator of @helena/sdk (hub/framework, packages/sdk/src/
// policy.ts): registered in `registries.policies`, it answers the same question for every
// caller the framework routes through its policy host (Helena's MCP tools, connector
// services, plugin tools). Registering it is one line where the API builds its host:
//   registries.policies.register(autopilotPolicyEvaluator)
// The types below mirror the SDK's until hub/framework is on the hub; then they are imported.

// mirror of @helena/sdk AgentRef / ProjectRef / PolicyContext / PolicyRequest / PolicyDecision
interface AgentRef {
  id: number;
  userId?: string;
  name?: string;
  templateId?: number | null;
}
interface ProjectRef {
  id: number;
  key?: string;
  teamId?: number;
}
interface PolicyContext {
  tool?: string;
  connector?: string;
  service?: string;
  stepType?: string;
  runtime?: string;
  target?: string;
  amount?: { value: number; currency: string };
  runId?: number | null;
  issueId?: number | null;
  input?: unknown;
}
export interface SdkPolicyRequest {
  agent: AgentRef | null;
  project: ProjectRef | null;
  action: string;
  context: PolicyContext;
}
export interface SdkPolicyDecision {
  effect: 'allow' | 'needs-approval' | 'deny';
  reason: string;
  evaluator?: string;
}

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

export const autopilotPolicyEvaluator = {
  id: AUTOPILOT_EVALUATOR_ID,
  async evaluate(request: SdkPolicyRequest): Promise<SdkPolicyDecision | null> {
    // An action outside the Autopilot's categories is not its question.
    if (!isActionCategory(request.action)) return null;
    // A person acting is decided by permissions, not by the Autopilot.
    if (!request.agent) return null;
    const context = request.context ?? {};
    // A connector's or plugin's delete or execute reaches outside the agent's workspace
    // unless the caller says otherwise.
    const scope: ActionScope =
      (context.input as { scope?: ActionScope } | undefined)?.scope === 'workspace'
        ? 'workspace'
        : request.action === 'delete' || request.action === 'execute'
          ? 'external'
          : 'workspace';
    const decision = await decide({
      adapter: context.connector ? 'connector' : (context.runtime ?? 'sdk'),
      agentId: request.agent.id,
      teamId: request.project?.teamId ?? null,
      projectId: request.project?.id ?? null,
      runId: context.runId ?? null,
      category: request.action,
      scope,
      tool: context.tool ?? context.service ?? context.stepType ?? null,
      summary: context.target ?? null,
      command: context.runtime ? (context.target ?? null) : null,
    });
    return {
      effect: decision.outcome,
      reason: decisionSentence(decision),
      evaluator: AUTOPILOT_EVALUATOR_ID,
    };
  },
};
