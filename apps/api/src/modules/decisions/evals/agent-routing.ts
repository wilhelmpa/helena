import type { DecisionEvalSet } from '@helena/sdk';
import { agentRoutingQuestions } from '../triage-questions';

const CASES: [string, string, string][] = [
  ['incident', 'Produktionsstörung untersuchen', 'operations'],
  ['backup', 'Backup-Fehler beheben', 'operations'],
  ['invoice', 'Rechnung prüfen', 'finance'],
  ['payment', 'Zahlungseingang abgleichen', 'finance'],
  ['customer', 'Kundenanfrage beantworten', 'support'],
  ['delivery', 'Lieferung für Kunden verfolgen', 'support'],
  ['campaign', 'Marketingkampagne planen', 'marketing'],
  ['seo', 'Suchmaschinen-Titel verbessern', 'marketing'],
  ['unclear', 'Unklare Aufgabe ohne Zuständigkeit', 'none'],
  ['personal', 'Private Entscheidung des Eigentümers', 'none'],
];

export const AGENT_ROUTING_EVAL: DecisionEvalSet = {
  cases: CASES.map(([id, title, expected]) => ({
    id: `agent-routing.${id}`,
    context: JSON.stringify({
      title,
      candidates: ['operations', 'finance', 'support', 'marketing'],
    }),
    questions: agentRoutingQuestions(['operations', 'finance', 'support', 'marketing']),
    expected: { agent: expected },
  })),
  minPrecision: 0.85,
  minCoverage: 0.5,
};
