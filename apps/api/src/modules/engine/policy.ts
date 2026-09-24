import { enforceAgentLimits } from '#modules/agents/governance';
import type { PolicyDecider } from './sdk';

// The policy the engine asks until the autopilot (hub/autopilot) registers its own with
// setPolicyDecider: a workflow's approval gate (asked without an agent) always waits for
// a person, and an agent may run (`execute`) unless it is paused or one of its token
// ceilings or the project's is reached (which pauses it, as for every other run).
export const defaultPolicy: PolicyDecider = {
  async decide({ agentId, projectId, actionCategory, taskId }) {
    if (agentId === null)
      return actionCategory === 'report' ? { decision: 'allow' } : { decision: 'ask' };
    if (actionCategory === 'execute') {
      const refusal = await enforceAgentLimits(agentId, projectId, taskId ?? null);
      return refusal ? { decision: 'deny', reason: refusal } : { decision: 'allow' };
    }
    return { decision: 'allow' };
  },
};
