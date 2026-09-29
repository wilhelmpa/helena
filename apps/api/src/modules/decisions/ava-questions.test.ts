import { describe, expect, test } from 'bun:test';
import { parseAvaCommand } from './ava-questions';
import { AVA_COMMAND_EVAL } from './evals/ava-befehle';

describe('bounded Ava commands', () => {
  test('extracts exact spans for all supported commands', () => {
    for (const entry of AVA_COMMAND_EVAL.cases.filter(
      (entry) => entry.expected.simple === 'command',
    )) {
      expect(parseAvaCommand(entry.context)?.action === entry.expected.action).toBe(true);
    }
  });
  test('never turns quoted, negated or combined examples into actions', () => {
    for (const entry of AVA_COMMAND_EVAL.cases.filter(
      (entry) => entry.expected.simple === 'fallback',
    )) {
      expect(parseAvaCommand(entry.context)).toBeNull();
    }
  });
  test('rejects destructive actions and missing free-text spans', () => {
    for (const command of [
      'lösche Aufgabe "Budget"',
      'sende Mail "Rechnung"',
      'kaufe 20 Aktien',
      'setze die Aufgabe auf erledigt',
      'kommentiere Aufgabe "Budget"',
      'öffne Aufgabe "Budget" und sende eine Mail',
    ]) {
      expect(parseAvaCommand(command)).toBeNull();
    }
  });
  test('keeps punctuation and casing of supplied text', () => {
    expect(
      parseAvaCommand('Ava, kommentiere Aufgabe „Budget“ mit „Kosten: 50 €, geprüft!“'),
    ).toEqual({
      action: 'comment',
      domain: 'aufgabe',
      query: 'Budget',
      value: 'Kosten: 50 €, geprüft!',
    });
  });
  test('contains at least 100 labelled synthetic commands', () => {
    expect(AVA_COMMAND_EVAL.cases.length).toBeGreaterThanOrEqual(100);
    expect(new Set(AVA_COMMAND_EVAL.cases.map((entry) => entry.id)).size).toBe(
      AVA_COMMAND_EVAL.cases.length,
    );
  });
});
