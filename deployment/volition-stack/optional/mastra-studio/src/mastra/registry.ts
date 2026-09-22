import { createStep, createWorkflow } from '@mastra/core/workflows';
import { privateClassifierAdapter } from './adapters/classifier.ts';
import { dryRunPlannerAdapter, type PlannerOperation } from './adapters/planner.ts';
import {
  approvalResumeSchema,
  approvalSuspendSchema,
  inboxWorkflowStateSchema,
  workflowOutputSchema,
  workflowStateSchema,
  workEnvelopeSchema,
  type WorkflowId,
} from './contracts.ts';
import { approvalEffects, planEffects, type EffectSpec } from './effects.ts';

export interface WorkflowDefinition {
  id: WorkflowId;
  name: string;
  description: string;
  operation: PlannerOperation;
  effects: readonly EffectSpec[];
}

export const workflowDefinitions: readonly WorkflowDefinition[] = [
  {
    id: 'inbox-triage',
    name: 'Inbox triage',
    description: 'Classify an inbound message and prepare a bounded routing proposal.',
    operation: 'classify',
    effects: [
      { kind: 'analysis', target: 'inbox:classification', description: 'Classify and route the message' },
      { kind: 'internal-write', target: 'plan:issue', description: 'Let the existing Plan worker create or update the proposed issue' },
    ],
  },
  {
    id: 'career-research',
    name: 'Career research',
    description: 'Research a role and produce a fit report without applying or contacting anyone.',
    operation: 'research',
    effects: [
      { kind: 'read', target: 'career:sources', description: 'Read the supplied role sources' },
      { kind: 'draft', target: 'career:fit-report', description: 'Draft a fit report' },
    ],
  },
  {
    id: 'application',
    name: 'Application',
    description: 'Prepare an application package; submission always requires a human handoff.',
    operation: 'draft',
    effects: [
      { kind: 'draft', target: 'application:package', description: 'Draft the application package' },
      { kind: 'external-send', target: 'application:submit', description: 'Submit the application' },
    ],
  },
  {
    id: 'support',
    name: 'Support',
    description: 'Triage a support request and prepare a reply; sending remains approval-gated.',
    operation: 'draft',
    effects: [
      { kind: 'analysis', target: 'support:triage', description: 'Classify the support request' },
      { kind: 'external-send', target: 'support:reply', description: 'Send the prepared reply' },
    ],
  },
  {
    id: 'system-audit',
    name: 'System audit',
    description: 'Create a read-only audit plan and findings envelope.',
    operation: 'audit',
    effects: [
      { kind: 'read', target: 'system:inventory', description: 'Read system status and configuration' },
      { kind: 'draft', target: 'system:audit-report', description: 'Draft the audit report' },
    ],
  },
  {
    id: 'document-filing',
    name: 'Document filing',
    description: 'Classify a document and propose a filing destination; storage writes require approval.',
    operation: 'file',
    effects: [
      { kind: 'analysis', target: 'document:classification', description: 'Classify the document' },
      { kind: 'external-write', target: 'capability:document-store.v1', description: 'Apply metadata and file the document through the configured project capability' },
    ],
  },
] as const;

function buildWorkflow(definition: WorkflowDefinition) {
  const prepare = createStep({
    id: 'prepare-plan',
    description: 'Validate the common event envelope and build an idempotent effect plan.',
    inputSchema: workEnvelopeSchema,
    outputSchema: workflowStateSchema,
    execute: async ({ inputData }) => {
      const preview = await dryRunPlannerAdapter.plan({
        operation: definition.operation,
        workflowId: definition.id,
        envelope: inputData,
        instructions: definition.description,
      });
      return {
        workflowId: definition.id,
        envelope: inputData,
        summary: preview.summary,
        effects: planEffects(inputData, definition.id, definition.effects),
      };
    },
  });

  const gate = createStep({
    id: 'approval-gate',
    description: 'Complete a dry-run or suspend before any external write or send.',
    inputSchema: workflowStateSchema,
    outputSchema: workflowOutputSchema,
    suspendSchema: approvalSuspendSchema,
    resumeSchema: approvalResumeSchema,
    execute: async ({ inputData, resumeData, suspend }) => {
      const gated = approvalEffects(inputData.effects);
      if (inputData.envelope.dryRun || gated.length === 0) {
        return {
          workflowId: inputData.workflowId,
          correlationId: inputData.envelope.correlationId,
          status: 'dry-run-complete' as const,
          summary: inputData.summary,
          effects: inputData.effects,
        };
      }
      if (!resumeData) {
        return await suspend({
          kind: 'approval-required',
          workflowId: inputData.workflowId,
          correlationId: inputData.envelope.correlationId,
          reason: 'External writes and sends require explicit human approval.',
          effectIds: gated.map(effect => effect.id),
        });
      }
      if (!resumeData.approved) {
        return {
          workflowId: inputData.workflowId,
          correlationId: inputData.envelope.correlationId,
          status: 'rejected' as const,
          summary: `Rejected by ${resumeData.decidedBy}; no external effect was executed.`,
          effects: inputData.effects,
        };
      }
      return {
        workflowId: inputData.workflowId,
        correlationId: inputData.envelope.correlationId,
        status: 'needs-attention' as const,
        summary: 'Approved, but production adapters are intentionally disabled. No external effect was executed.',
        effects: inputData.effects,
      };
    },
  });

  return createWorkflow({
    id: definition.id,
    description: `${definition.name}: ${definition.description}`,
    inputSchema: workEnvelopeSchema,
    outputSchema: workflowOutputSchema,
  })
    .then(prepare)
    .then(gate)
    .commit();
}

function buildInboxWorkflow(definition: WorkflowDefinition) {
  const prepare = createStep({
    id: 'prepare-inbox',
    description: 'Validate the event and create stable effect identifiers before classification.',
    inputSchema: workEnvelopeSchema,
    outputSchema: inboxWorkflowStateSchema,
    execute: async ({ inputData }) => ({
      workflowId: definition.id,
      envelope: inputData,
      summary: inputData.dryRun
        ? 'Inbox classification validated; no classifier call was made'
        : 'Inbox classification prepared',
      effects: planEffects(inputData, definition.id, definition.effects),
      triage: null,
    }),
  });

  const classify = createStep({
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

  return createWorkflow({
    id: definition.id,
    description: `${definition.name}: ${definition.description}`,
    inputSchema: workEnvelopeSchema,
    outputSchema: workflowOutputSchema,
    retryConfig: { attempts: 3, delay: 1000 },
  })
    .then(prepare)
    .then(classify)
    .commit();
}

export const workflowRegistry = Object.fromEntries(
  workflowDefinitions.map(definition => [
    definition.id,
    definition.id === 'inbox-triage' ? buildInboxWorkflow(definition) : buildWorkflow(definition),
  ]),
);
