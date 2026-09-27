import { expect, it } from 'bun:test';
import { decisionAttempts } from './attempts';

it('preserves the regular primary when its connection is also the optional stage', () => {
  expect(decisionAttempts(46, 46, null)).toEqual([
    { credentialId: 46, role: 'first-stage' },
    { credentialId: 46, role: 'regular' },
  ]);
});

it('preserves a separately configured fallback after the stage and another primary', () => {
  expect(decisionAttempts(46, 12, 46)).toEqual([
    { credentialId: 46, role: 'first-stage' },
    { credentialId: 12, role: 'regular' },
    { credentialId: 46, role: 'regular' },
  ]);
});

it('deduplicates ordinary primary and fallback without merging their role with the stage', () => {
  expect(decisionAttempts(46, 46, 46)).toEqual([
    { credentialId: 46, role: 'first-stage' },
    { credentialId: 46, role: 'regular' },
  ]);
  expect(decisionAttempts(undefined, 46, 46)).toEqual([{ credentialId: 46, role: 'regular' }]);
});

it('does not infer regular permission from the optional connection', () => {
  expect(decisionAttempts(46, null, null)).toEqual([{ credentialId: 46, role: 'first-stage' }]);
  expect(decisionAttempts(undefined, null, null)).toEqual([]);
});
