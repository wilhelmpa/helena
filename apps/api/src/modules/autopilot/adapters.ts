import {
  BROWSER_GATEWAY_TOOL_CATEGORY,
  WORKFLOW_STEP_CATEGORY,
  classifyToolCall,
  isActionCategory,
  type ActionCategory,
} from '@helena/policy';
import { enforceAgentLimits } from '#modules/agents/governance';
import { decide, type EngineDecision } from './engine';

// Adapters for the callers that live on other branches and ask the policy engine in-process:
// the workflow engine (hub/native-engine, its PolicyDecider seam) and the browser gateway
// (hub/agent-browser-mcp, its internal routes). Both can also ask over HTTP, like every
// runtime: POST /agent-policy/decide with the agent's key.

// ---- hub/native-engine ----------------------------------------------------------------
// engine/sdk.ts on that branch defines this seam; registering the Autopilot is one line at
// startup: setPolicyDecider(autopilotPolicyDecider).

type EngineCategory = ActionCategory | 'run' | 'approve' | (string & {});

export interface EnginePolicyInput {
  agentId: number | null;
  projectId: number;
  actionCategory: EngineCategory;
  taskId?: number | null;
  subject?: string;
}

export type EnginePolicyDecision =
  | { decision: 'allow'; reason?: string }
  | { decision: 'ask'; reason?: string }
  | { decision: 'deny'; reason: string };

function engineAnswer(decision: EngineDecision): EnginePolicyDecision {
  if (decision.outcome === 'allow') return { decision: 'allow', reason: decision.reason };
  if (decision.outcome === 'needs-approval') return { decision: 'ask', reason: decision.message };
  return { decision: 'deny', reason: decision.message };
}

export const autopilotPolicyDecider = {
  async decide(input: EnginePolicyInput): Promise<EnginePolicyDecision> {
    // An approval gate the owner put into a workflow always waits for a person, at every
    // level: it is the owner's own decision to be asked there.
    if (input.actionCategory === 'approve') {
      return { decision: 'ask', reason: 'The workflow asks a person here.' };
    }
    // Starting an agent: the agent's pause and the budgets decide (a used-up budget stops it).
    if (input.actionCategory === 'run') {
      if (input.agentId === null) return { decision: 'allow' };
      const refusal = await enforceAgentLimits(
        input.agentId,
        input.projectId,
        input.taskId ?? null,
      );
      return refusal ? { decision: 'deny', reason: refusal } : { decision: 'allow' };
    }
    const category: ActionCategory = isActionCategory(input.actionCategory)
      ? input.actionCategory
      : (WORKFLOW_STEP_CATEGORY[input.actionCategory] ?? 'send');
    return engineAnswer(
      await decide({
        adapter: 'workflow',
        agentId: input.agentId,
        projectId: input.projectId,
        category,
        scope: category === 'send' || category === 'publish' ? 'external' : 'workspace',
        tool: `workflow:${input.actionCategory}`,
        summary: input.subject ?? null,
      }),
    );
  },
};

// ---- hub/agent-browser-mcp -------------------------------------------------------------
// The gateway knows the agent (its key), the project and the tool; a click that submits,
// sends or pays can be declared with `intent`, which only ever makes the call weightier.

export async function decideBrowserTool(input: {
  agent: { id: number; teamId: number };
  projectId: number | null;
  tool: string;
  intent?: ActionCategory | null;
  runId?: number | null;
  chatMessageId?: number | null;
  target?: string | null;
}): Promise<EngineDecision> {
  const { category, scope } = classifyToolCall({
    runtime: 'gateway',
    tool: input.tool,
    intent: input.intent ?? null,
  });
  return decide({
    adapter: 'gateway',
    agentId: input.agent.id,
    teamId: input.agent.teamId,
    projectId: input.projectId,
    runId: input.runId ?? null,
    chatMessageId: input.chatMessageId ?? null,
    category,
    scope,
    tool: input.tool,
    summary: input.target ? `${input.tool} ${input.target}` : input.tool,
  });
}

// The browser tools the gateway serves and their categories, for its tool list.
export const browserToolCategories = BROWSER_GATEWAY_TOOL_CATEGORY;
