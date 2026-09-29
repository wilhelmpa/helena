import { expect, test } from 'bun:test';
import { browserDecisionConfident, browserQuestions } from './cascade';
import type { AskResult } from '#modules/decisions/service';

test('browser cascade keeps question rules and target IDs', () => {
  expect(
    browserQuestions({
      operation: {
        type: 'choice',
        instructions: { rules: ['Never write in read mode.'] },
        criteria: { WAIT: 'Wait', DONE: 'Finished' },
      },
      done: { type: 'noul', instructions: 'Is the goal verified?' },
    }),
  ).toEqual({
    operation: {
      kind: 'choice',
      question: '{"rules":["Never write in read mode."]}',
      options: [
        { id: 'WAIT', label: 'Wait' },
        { id: 'DONE', label: 'Finished' },
      ],
    },
    done: { kind: 'yesno', question: 'Is the goal verified?' },
  });
});

test('only the selected operation and its target may authorize a browser step', () => {
  const result = {
    answers: {
      operation: { choice: 'CLICK', confidence: 0.99, probabilities: { CLICK: 0.99 } },
      click_target: { choice: '2', confidence: 0.99, probabilities: { '2': 0.99 } },
      type_target: { choice: '3', confidence: 0.1, probabilities: { '3': 0.1 } },
    },
  } as unknown as AskResult;
  expect(browserDecisionConfident(result, 0.95)).toBe(true);
  result.answers.click_target!.confidence = 0.5;
  expect(browserDecisionConfident(result, 0.95)).toBe(false);
  delete result.answers.click_target;
  expect(browserDecisionConfident(result, 0.95)).toBe(false);
});

test('an empty or malformed browser decision cannot authorize a step', () => {
  expect(browserDecisionConfident({ answers: {} } as AskResult, 0.95)).toBe(false);
  expect(() => browserQuestions({ q: { type: 'free-text' } })).toThrow();
});
