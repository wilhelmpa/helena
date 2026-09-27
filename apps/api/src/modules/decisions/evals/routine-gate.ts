import type { DecisionEvalSet } from '@helena/sdk';
import { routineGateQuestions } from '../questions';

type Case = [string, 'mail' | 'audit', number, number, string, 'run' | 'skip'];

const CASES: Case[] = [
  ['mail-new-request', 'mail', 3, 3, 'Bitte um Rückruf heute', 'run'],
  ['mail-new-invoice', 'mail', 1, 1, 'Rechnung mit Zahlungsfrist', 'run'],
  ['mail-many-unread', 'mail', 0, 8, 'Mehrere ungelesene Nachrichten', 'run'],
  ['mail-new-even-seen', 'mail', 2, 0, 'Neue Nachrichten seit dem letzten Lauf', 'run'],
  ['mail-new-family', 'mail', 1, 1, 'Schultermin geändert', 'run'],
  ['audit-overdue', 'audit', 4, 2, 'Zwei überfällige Tickets', 'run'],
  ['audit-many-open', 'audit', 7, 0, 'Mehrere offene Tickets', 'run'],
  ['audit-recent-work', 'audit', 3, 0, 'Offene Aufgaben', 'run'],
  ['audit-deadline', 'audit', 1, 1, 'Frist heute', 'run'],
  ['audit-incident', 'audit', 2, 1, 'Störung prüfen', 'run'],
  ['mail-empty-1', 'mail', 0, 0, '', 'skip'],
  ['mail-empty-2', 'mail', 0, 0, 'Keine ungelesene Mail', 'skip'],
  ['mail-empty-3', 'mail', 0, 0, 'Postfach frisch synchronisiert', 'skip'],
  ['mail-empty-4', 'mail', 0, 0, 'Keine neue Nachricht seit letztem Lauf', 'skip'],
  ['mail-empty-5', 'mail', 0, 0, 'Alle Nachrichten bereits gelesen', 'skip'],
  ['audit-empty-1', 'audit', 0, 0, '', 'skip'],
  ['audit-empty-2', 'audit', 0, 0, 'Keine offenen Tickets', 'skip'],
  ['audit-empty-3', 'audit', 0, 0, 'Alle Tickets abgeschlossen', 'skip'],
  ['audit-empty-4', 'audit', 0, 0, 'Keine überfälligen Aufgaben', 'skip'],
  ['audit-empty-5', 'audit', 0, 0, 'Leeres Board', 'skip'],
  ['mail-one-bill', 'mail', 0, 1, 'Mahnung: Zahlung bis heute', 'run'],
  ['mail-one-family', 'mail', 0, 1, 'Kita schließt morgen früher', 'run'],
  ['mail-one-question', 'mail', 0, 1, 'Bitte beantworten Sie meine Frage', 'run'],
  ['mail-one-newsletter', 'mail', 0, 1, 'Wöchentlicher Newsletter', 'skip'],
  ['mail-one-advert', 'mail', 0, 1, 'Sonderangebot für Laufschuhe', 'skip'],
  ['audit-one-urgent', 'audit', 1, 0, 'Produktionsfehler heute prüfen', 'run'],
  ['audit-one-request', 'audit', 1, 0, 'Kundenfrage beantworten', 'run'],
  ['audit-one-backlog', 'audit', 1, 0, 'Idee für nächstes Quartal', 'skip'],
  ['audit-one-archive', 'audit', 1, 0, 'Alte Notiz irgendwann archivieren', 'skip'],
  ['audit-one-unclear', 'audit', 1, 0, 'Status prüfen', 'run'],
];

export const ROUTINE_GATE_EVAL: DecisionEvalSet = {
  cases: CASES.map(([id, source, first, second, evidence, expected]) => ({
    id: `routine-gate.${id}`,
    context: JSON.stringify({
      source,
      title: source === 'mail' ? 'Mail triage' : 'Home audit',
      counts:
        source === 'mail' ? { newMail: first, unread: second } : { open: first, overdue: second },
      evidence,
    }),
    questions: routineGateQuestions(),
    expected: { run: expected },
  })),
  minPrecision: 0.85,
  minCoverage: 0.5,
};
