import { actionRank, type ActionCategory, type PolicyEffect } from '@helena/sdk';
import { aiAgent, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { host, registries } from '#shared/helena';
import { enforceAgentLimits } from '#modules/agents/governance';
import { loadRun } from './run-context';
import type { PolicyDecider, StepDefinition, WorkflowStepType } from './sdk';

// The engine's two questions of its own, answered like the Autopilot's engine adapter
// (autopilot/adapters.ts autopilotPolicyDecider): an approval step ('approve') waits for a
// person, and an agent may start a run ('run') unless it is paused or one of its budgets or
// the project's is used up (which pauses it, as for every other run).
export const defaultPolicy: PolicyDecider = {
  async decide({ agentId, projectId, actionCategory, taskId }) {
    if (actionCategory === 'approve') return { decision: 'ask' };
    if (actionCategory === 'run' && agentId !== null) {
      const refusal = await enforceAgentLimits(agentId, projectId, taskId ?? null);
      return refusal ? { decision: 'deny', reason: refusal } : { decision: 'allow' };
    }
    return { decision: 'allow' };
  },
};

export interface StepVerdict {
  effect: PolicyEffect;
  reason: string;
}

const ALLOWED: StepVerdict = { effect: 'allow', reason: '' };

// Where an action of the category lands, for an evaluator that tells the two apart.
function scopeOf(category: ActionCategory): 'workspace' | 'external' {
  return category === 'send' || category === 'publish' || category === 'pay'
    ? 'external'
    : 'workspace';
}

// Asks the framework's policy host (@helena/sdk `decide` over `registries.policies`, where
// the Autopilot is the built-in evaluator) whether the step may do what its type does
// (orchestrator decision D-C1). Reading and reporting are never asked about, a test run
// does nothing, and without a registered policy everything is allowed, as before policies
// existed. The agent is the one that started the run, when an agent did: a run a person
// started is the person's action, which the Autopilot leaves to permissions.
export async function askStepPolicy(
  runId: string,
  step: StepDefinition,
  type: WorkflowStepType,
): Promise<StepVerdict> {
  const category = type.category;
  if (!category || actionRank(category) <= actionRank('report')) return ALLOWED;
  if (registries.policies.list().length === 0) return ALLOWED;
  const context = await loadRun(runId);
  if (context.run.dryRun) return ALLOWED;
  const [agent] = context.run.actorUserId
    ? await db
        .select({ id: aiAgent.id, name: aiAgent.username, templateId: aiAgent.sourceTemplateId })
        .from(aiAgent)
        .where(eq(aiAgent.userId, context.run.actorUserId))
        .limit(1)
    : [];
  const decision = await host.decide({
    agent: agent
      ? {
          id: agent.id,
          userId: context.run.actorUserId!,
          name: agent.name,
          templateId: agent.templateId,
        }
      : null,
    project: {
      id: context.project.id,
      key: context.project.key,
      teamId: context.project.teamId,
    },
    action: category,
    context: {
      stepType: step.type,
      issueId: context.run.issueId,
      target: `${context.name}: ${step.name}`,
      scope: scopeOf(category),
    },
  });
  return { effect: decision.effect, reason: decision.reason };
}
