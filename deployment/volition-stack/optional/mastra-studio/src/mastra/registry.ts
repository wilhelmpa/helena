import { createStep, createWorkflow } from '@mastra/core/workflows';
import { privateClassifierAdapter } from './adapters/classifier.ts';
import {
  inboxWorkflowStateSchema,
  workflowOutputSchema,
  workEnvelopeSchema,
} from './contracts.ts';
import { planEffects, type EffectSpec } from './effects.ts';
import { planPipelineWorkflow } from './pipeline-workflow.ts';
import { agentRoutineWorkflow } from './routine-workflow.ts';
import { agentTeamWorkflow } from './team-workflow.ts';

const inboxEffects: readonly EffectSpec[] = [
  { kind: 'analysis', target: 'inbox:classification', description: 'Classify and route the message' },
  { kind: 'internal-write', target: 'plan:issue', description: 'Let the existing Helena worker create or update the proposed issue' },
];

const prepareInbox = createStep({
  id: 'prepare-inbox',
  description: 'Validate the event and create stable effect identifiers before classification.',
  inputSchema: workEnvelopeSchema,
  outputSchema: inboxWorkflowStateSchema,
  execute: async ({ inputData }) => ({
    workflowId: 'inbox-triage' as const,
    envelope: inputData,
    summary: inputData.dryRun
      ? 'Inbox classification validated; no classifier call was made'
      : 'Inbox classification prepared',
    effects: planEffects(inputData, 'inbox-triage', inboxEffects),
    triage: null,
  }),
});

const classifyInbox = createStep({
  id: 'classify-inbox',
  description: 'Run the configured tool-free classifier capability through the private host adapter.',
  inputSchema: inboxWorkflowStateSchema,
  outputSchema: workflowOutputSchema,
  retries: 2,
  execute: async ({ inputData }) => {
    if (inputData.envelope.dryRun) {
      return {
        workflowId: inputData.workflowId,
        correlationId: inputData.envelope.correlationId,
        status: 'dry-run-complete' as const,
        summary: inputData.summary,
        effects: inputData.effects,
      };
    }
    const triage = await privateClassifierAdapter.classify(inputData.envelope);
    return {
      workflowId: inputData.workflowId,
      correlationId: inputData.envelope.correlationId,
      status: 'completed' as const,
      summary: triage.summary,
      effects: inputData.effects,
      triage,
    };
  },
});

const inboxTriageWorkflow = createWorkflow({
  id: 'inbox-triage',
  description: 'Inbox triage: Classify an inbound message and prepare a bounded routing proposal.',
  inputSchema: workEnvelopeSchema,
  outputSchema: workflowOutputSchema,
  retryConfig: { attempts: 3, delay: 1000 },
})
  .then(prepareInbox)
  .then(classifyInbox)
  .commit();

export const workflowRegistry = {
  'inbox-triage': inboxTriageWorkflow,
  'agent-team': agentTeamWorkflow,
  'agent-routine': agentRoutineWorkflow,
  'plan-pipeline': planPipelineWorkflow,
};
