import { describe, expect, it } from 'bun:test';

import { decisionOptionIds, decisionQuestionProblem, type DecisionEvalSet } from '@helena/sdk';

import { GENERIC_EVAL } from './generic';
import { MAIL_EVAL } from './mail';
import { RECEIPT_EVAL } from './receipts';
import { ROUTER_EVAL } from './router';

// The labelled cases of Helena's decision classes are well-formed: every case asks questions
// a backend accepts, and every expected answer is one of the options it offers.

const SETS: [name: string, set: DecisionEvalSet, size: number][] = [
  ['router', ROUTER_EVAL, 40],
  ['mail', MAIL_EVAL, 46],
  ['receipts', RECEIPT_EVAL, 25],
  ['generic', GENERIC_EVAL, 24],
];

function problems(set: DecisionEvalSet): string[] {
  const found: string[] = [];
  for (const entry of set.cases) {
    const where = `case ${entry.id}`;
    if (!entry.context.trim()) found.push(`${where}: empty context`);
    if (entry.context.length > 2000)
      found.push(`${where}: context has ${entry.context.length} characters`);
    for (const [key, question] of Object.entries(entry.questions)) {
      const problem = decisionQuestionProblem(question);
      if (problem) found.push(`${where}, question ${key}: ${problem}`);
      if (!(key in entry.expected)) found.push(`${where}: no expected answer for ${key}`);
    }
    for (const [key, expected] of Object.entries(entry.expected)) {
      const question = entry.questions[key];
      if (!question) {
        found.push(`${where}: expected answer for unknown question ${key}`);
        continue;
      }
      const answers = Array.isArray(expected) ? expected : [expected];
      if (answers.length === 0) found.push(`${where}, question ${key}: no expected answer`);
      if (new Set(answers).size !== answers.length)
        found.push(`${where}, question ${key}: an expected answer is listed twice`);
      const options = decisionOptionIds(question);
      for (const answer of answers) {
        if (!options.includes(answer))
          found.push(`${where}, question ${key}: "${answer}" is not an option`);
      }
    }
  }
  return found;
}

for (const [name, set, size] of SETS) {
  describe(`${name} eval`, () => {
    it(`has ${size} cases with unique ids`, () => {
      expect(set.cases).toHaveLength(size);
      const ids = set.cases.map((entry) => entry.id);
      expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    });

    it('has pass thresholds between 0 and 1', () => {
      expect(set.minPrecision).toBeGreaterThan(0);
      expect(set.minPrecision).toBeLessThanOrEqual(1);
      expect(set.minCoverage).toBeGreaterThan(0);
      expect(set.minCoverage).toBeLessThanOrEqual(1);
    });

    it('asks valid questions and expects only their options', () => {
      expect(problems(set)).toEqual([]);
    });
  });
}
