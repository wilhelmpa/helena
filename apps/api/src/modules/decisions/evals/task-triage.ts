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
  ['api-down', 'Öffentliche API antwortet seit fünf Minuten nicht', 'operations', 'urgent'],
  ['data-loss', 'Produktionsdaten werden gerade gelöscht', 'operations', 'urgent'],
  ['backup-alert', 'Backup der letzten Nacht ist fehlgeschlagen', 'operations', 'high'],
  ['deploy', 'Geplantes Release nächste Woche vorbereiten', 'operations', 'medium'],
  ['server-metrics', 'Monatlichen Serverbericht prüfen', 'operations', 'low'],
  ['refund', 'Zugesagte Rückerstattung heute veranlassen', 'finance', 'high'],
  ['tax-document', 'Steuerbeleg für Monatsabschluss zuordnen', 'finance', 'high'],
  ['bank-reconcile', 'Zahlungseingänge dieser Woche abgleichen', 'finance', 'medium'],
  ['budget-draft', 'Budgetentwurf für nächstes Quartal erstellen', 'finance', 'medium'],
  ['old-receipt', 'Alten Beleg optional nachsortieren', 'finance', 'low'],
  ['customer-blocked', 'Kunde kann seinen Auftrag heute nicht abschließen', 'support', 'high'],
  ['support-reply', 'Kundenfrage zu einem Liefertermin beantworten', 'support', 'medium'],
  ['faq', 'Häufige Kundenfrage in die FAQ aufnehmen', 'support', 'low'],
  ['feedback', 'Kundenfeedback für die nächste Planung sammeln', 'support', 'low'],
  ['appointment-change', 'Kundentermin für nächste Woche verschieben', 'support', 'medium'],
  ['press', 'Pressemitteilung für nächste Woche vorbereiten', 'marketing', 'medium'],
  ['social', 'Social-Media-Text für den Monatsplan schreiben', 'marketing', 'medium'],
  ['landing', 'Landingpage-Text für die Kampagne überarbeiten', 'marketing', 'medium'],
  ['brand-ideas', 'Optionale Markenideen sammeln', 'marketing', 'low'],
  ['unknown-owner', 'Unklare private Entscheidung ohne benannte Zuständigkeit', 'none', 'medium'],
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
