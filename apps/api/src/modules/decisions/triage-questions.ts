import type { DecisionQuestion } from '@helena/sdk';

export interface TriageCandidate {
  id: string;
  label: string;
}

const option = (candidate: string | TriageCandidate) =>
  typeof candidate === 'string' ? { id: candidate, label: candidate } : candidate;

export function taskTriageQuestions(candidates: readonly (string | TriageCandidate)[]) {
  return {
    owner: {
      kind: 'choice',
      question:
        'Which eligible responsibility fits this task? Choose none if the evidence is ambiguous.',
      options: [
        ...candidates.map(option),
        { id: 'human', label: 'A person must take responsibility.' },
        { id: 'none', label: 'No clear responsibility.' },
      ],
    },
    priority: {
      kind: 'choice',
      question: 'How urgent is this task? Do not calculate deadlines; use only explicit evidence.',
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
        'Which eligible agent should handle this task? Choose none if unclear or human judgment is needed.',
      options: [
        ...candidates.map(option),
        { id: 'human', label: 'Hand the task to a person.' },
        { id: 'none', label: 'No safe automatic route.' },
      ],
    },
  } satisfies Record<string, DecisionQuestion>;
}
