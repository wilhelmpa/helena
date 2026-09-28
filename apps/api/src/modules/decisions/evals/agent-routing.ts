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
  ['api-down', 'Öffentliche API ist nicht erreichbar', 'operations'],
  ['deploy', 'Geplantes Release vorbereiten', 'operations'],
  ['monitoring', 'Server-Monitoring überprüfen', 'operations'],
  ['database', 'Datenbank-Backup prüfen', 'operations'],
  ['uptime', 'Verfügbarkeitsalarm untersuchen', 'operations'],
  ['tax', 'Steuerbeleg prüfen', 'finance'],
  ['refund', 'Rückerstattung vorbereiten', 'finance'],
  ['budget', 'Budgetentwurf erstellen', 'finance'],
  ['bank', 'Bankbuchung abgleichen', 'finance'],
  ['receipt', 'Quittung einer Rechnung zuordnen', 'finance'],
  ['support-mail', 'Kunden-E-Mail beantworten', 'support'],
  ['support-call', 'Rückruf für Kunden vorbereiten', 'support'],
  ['faq', 'Kunden-FAQ aktualisieren', 'support'],
  ['complaint', 'Kundenbeschwerde prüfen', 'support'],
  ['delivery-status', 'Versandstatus für Kunden ermitteln', 'support'],
  ['newsletter', 'Newsletter entwerfen', 'marketing'],
  ['ad', 'Anzeigentext schreiben', 'marketing'],
  ['landing', 'Landingpage-Text verbessern', 'marketing'],
  ['press', 'Presseankündigung vorbereiten', 'marketing'],
  ['no-evidence', 'Bitte kümmere dich darum', 'none'],
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
