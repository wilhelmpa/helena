import { enforceAgentLimits } from '#modules/agents/governance';
import type { PolicyDecider } from './sdk';

// The policy the engine asks until the autopilot (hub/autopilot) registers its own with
// setPolicyDecider(autopilotPolicyDecider), which answers the same way: an approval step
// ('approve') waits for a person, and an agent may start a run ('run') unless it is
// paused or one of its token ceilings or the project's is reached (which pauses it, as
// for every other run). Nothing else asks yet.
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
