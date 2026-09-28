import type { DecisionEvalSet } from '@helena/sdk';
import { taskTriageQuestions } from '../triage-questions';

const CASES: [string, string, string, 'urgent' | 'high' | 'medium' | 'low'][] = [
  ['incident', 'Produktionssystem ausgefallen, Kunden blockiert', 'operations', 'urgent'],
  ['security', 'Aktiver Missbrauch eines Kontos', 'operations', 'urgent'],
  ['payment', 'Kunde meldet fehlgeschlagene Zahlung heute', 'finance', 'high'],
  ['invoice', 'Rechnung mit Frist morgen prüfen', 'finance', 'high'],
  ['customer', 'Kundenfrage zum bestehenden Auftrag beantworten', 'support', 'medium'],
  ['delivery', 'Lieferstatus für Kunden nachsehen', 'support', 'medium'],
  ['campaign', 'Neue Kampagne für nächsten Monat skizzieren', 'marketing', 'medium'],
  ['seo', 'Seitentitel für Suchmaschinen prüfen', 'marketing', 'medium'],
  ['backlog', 'Optionale Idee für spätere Verbesserung', 'none', 'low'],
  ['archive', 'Alte Notizen bei Gelegenheit ordnen', 'none', 'low'],
];

export const TASK_TRIAGE_EVAL: DecisionEvalSet = {
  cases: CASES.map(([id, title, owner, priority]) => ({
    id: `task-triage.${id}`,
    context: JSON.stringify({
      title,
      description: '',
      candidates: ['operations', 'finance', 'support', 'marketing'],
    }),
    questions: taskTriageQuestions(['operations', 'finance', 'support', 'marketing']),
    expected: { owner, priority },
  })),
  minPrecision: 0.85,
  minCoverage: 0.5,
};
