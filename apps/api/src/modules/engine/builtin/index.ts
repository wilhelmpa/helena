import { registerStepType, registerTriggerType, setDefaultPolicyDecider } from '../registry';
import { defaultPolicy } from '../policy';
import { actionStep } from './steps/action';
import { agentStep } from './steps/agent';
import { agentTeamStep } from './steps/agent-team';
import { approvalStep } from './steps/approval';
import { conditionStep } from './steps/condition';
import { decisionStep } from './steps/decision';
import { delegateStep } from './steps/delegate';
import { notifyStep } from './steps/notify';
import { waitStep } from './steps/wait';
import { webhookStep } from './steps/webhook';
import { BUILTIN_TRIGGERS } from './triggers';

// Helena's own step and trigger types, registered through the same registry a plugin
// uses: they are the engine's first "internal plugin".

let registered = false;

export function registerBuiltins(): void {
  if (registered) return;
  registered = true;
  for (const step of [
    agentStep,
    approvalStep,
    conditionStep,
    decisionStep,
    actionStep,
    waitStep,
    notifyStep,
    webhookStep,
    delegateStep,
    agentTeamStep,
  ])
    registerStepType(step as never);
  for (const trigger of BUILTIN_TRIGGERS) registerTriggerType(trigger);
  setDefaultPolicyDecider(defaultPolicy);
}
