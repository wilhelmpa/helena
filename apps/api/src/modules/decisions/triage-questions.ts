import type { DecisionQuestion } from '@helena/sdk';

export interface TriageCandidate {
  id: string;
  label: string;
}

const RESPONSIBILITIES: Record<string, string> = {
  operations:
    'Production availability, infrastructure, deployments, backups and active security incidents.',
  finance: 'Invoices, payments, refunds, accounting, tax documents and budgets.',
  support:
    'Customer questions, complaints, delivery inquiries, support documentation and customer feedback.',
  marketing:
    'Campaigns, SEO, press, newsletters, advertising, branding and optional marketing ideas.',
};

function option(candidate: string | TriageCandidate) {
  const entry = typeof candidate === 'string' ? { id: candidate, label: candidate } : candidate;
  const responsibility = RESPONSIBILITIES[entry.id];
  return responsibility ? { ...entry, label: `${entry.label}: ${responsibility}` } : entry;
}

export function taskTriageQuestions(candidates: readonly (string | TriageCandidate)[]) {
  return {
    owner: {
      kind: 'choice',
      question:
        'Choose responsibility by the underlying work, not the person reporting it. Payments, ' +
        'invoices and financial closing belong to finance when offered, even when a customer reports the problem. ' +
        'Production, backups and active account abuse belong to operations when offered. ' +
        'Use candidate labels for all other roles. Optional work can still have a clear owner. ' +
        'Choose none for missing or ambiguous responsibility, including unspecified private decisions. ' +
        'Choose human only for an explicit required human decision with a clear responsibility.',
      options: [
        ...candidates.map(option),
        { id: 'human', label: 'A person must take responsibility.' },
        { id: 'none', label: 'No clear responsibility.' },
      ],
    },
    priority: {
      kind: 'choice',
      question:
        'Use explicit urgency and impact, without calculating dates. Urgent requires active harm ' +
        'or an ongoing outage; a failed past backup requires prompt action, not an ongoing incident. ' +
        'High covers near deadlines, payment problems or financial closing obligations. ' +
        'Routine reporting, knowledge documentation, feedback collection and optional/deferred work ' +
        'are low unless a stronger obligation is explicit. Other ordinary work is medium; ' +
        'unclear responsibility alone does not imply low priority.',
      options: [
        { id: 'urgent', label: 'Incident or immediate harm.' },
        { id: 'high', label: 'Needs prompt action.' },
        { id: 'medium', label: 'Ordinary planned work.' },
        { id: 'low', label: 'Optional or deferred work.' },
      ],
    },
  } satisfies Record<string, DecisionQuestion>;
}

export function agentRoutingQuestions(candidates: readonly (string | TriageCandidate)[]) {
  return {
    agent: {
      kind: 'choice',
      question:
        'Route by underlying work and candidate capabilities, not by the requester. ' +
        'Use candidate labels to distinguish financial work, operations, customer service and marketing. ' +
        'Choose none if evidence or eligible responsibility is unclear, or the task is an unspecified ' +
        'private owner decision outside these agents. Choose human only for an explicit required human ' +
        'decision within a clear task responsibility. Do not infer additional eligible agents.',
      options: [
        ...candidates.map(option),
        { id: 'human', label: 'Hand the task to a person.' },
        { id: 'none', label: 'No safe automatic route.' },
      ],
    },
  } satisfies Record<string, DecisionQuestion>;
}
