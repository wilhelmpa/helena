import type { DecisionEvalSet } from '@helena/sdk';
import { AVA_QUESTIONS } from '../ava-questions';

const commands = [
  ['suche Aufgaben nach "Budget"', 'search'],
  ['finde Wissen nach "Onboarding"', 'search'],
  ['suche Belege nach "Büromaterial"', 'search'],
  ['finde Mails nach "Rechnung"', 'search'],
  ['suche Projekte nach "Website"', 'search'],
  ['finde Agenten nach "Recherche"', 'search'],
  ['öffne Aufgabe "Budget prüfen"', 'open'],
  ['öffne Wissen "Onboarding"', 'open'],
  ['öffne Beleg "Büromaterial"', 'open'],
  ['öffne Mail "Rechnung"', 'open'],
  ['öffne Projekt "Website"', 'open'],
  ['öffne Agent "Recherche"', 'open'],
  ['lege eine Aufgabe "Budget prüfen" in "Offen" an', 'create'],
  ['kommentiere Aufgabe "Budget prüfen" mit "Die Zahlen stimmen."', 'comment'],
  ['setze Aufgabe "Budget prüfen" auf "Erledigt"', 'status'],
  ['weise Aufgabe "Budget prüfen" an "Ada Beispiel" zu', 'assign'],
  ['setze die Fälligkeit der Aufgabe "Budget prüfen" auf 2026-10-12', 'due'],
  ['hänge an Aufgabe "Budget prüfen" die Datei "Notizen.pdf" an', 'attach'],
] as const;

export const AVA_COMMAND_EVAL: DecisionEvalSet = {
  minPrecision: 1,
  minCoverage: 0.8,
  cases: commands
    .flatMap(([command, action], index) => [
      { id: `ava.${index}.direct`, context: command, expected: { simple: 'command', action } },
      {
        id: `ava.${index}.wake`,
        context: `Ava, ${command}.`,
        expected: { simple: 'command', action },
      },
      {
        id: `ava.${index}.negated`,
        context: `Bitte führe diesen Befehl nicht aus: ${command}`,
        expected: { simple: 'fallback', action: 'fallback' },
      },
      {
        id: `ava.${index}.quoted`,
        context: `Erkläre den Satz: »${command}«`,
        expected: { simple: 'fallback', action: 'fallback' },
      },
      {
        id: `ava.${index}.multiple`,
        context: `${command} und lösche danach alle Mails.`,
        expected: { simple: 'fallback', action: 'fallback' },
      },
      {
        id: `ava.${index}.hypothetical`,
        context: `Wenn ich irgendwann »${command}« sage, was würde passieren?`,
        expected: { simple: 'fallback', action: 'fallback' },
      },
    ])
    .map((entry) => ({ ...entry, questions: AVA_QUESTIONS })),
};
