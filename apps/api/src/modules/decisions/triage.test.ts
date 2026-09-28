import { describe, expect, it } from 'bun:test';
import { cascadeAnswer } from './triage-cascade';

describe('decision cascade', () => {
  const allowed = ['a_1', 'a_2'];

  it('allows a high confidence eligible answer to act', () => {
    expect(
      cascadeAnswer(
        { choice: 'a_1', confidence: 0.9, decided: true, decisionId: 7, probabilities: null },
        allowed,
      ),
    ).toMatchObject({ step: 'act', choice: 'a_1', decisionId: 7 });
  });

  it('keeps a medium confidence answer as a suggestion', () => {
    expect(
      cascadeAnswer(
        { choice: 'a_1', confidence: 0.7, decided: false, decisionId: 8, probabilities: null },
        allowed,
      ),
    ).toMatchObject({ step: 'suggest', choice: 'a_1' });
  });

  it('escalates uncertain and ineligible answers', () => {
    expect(
      cascadeAnswer(
        { choice: 'a_1', confidence: 0.4, decided: false, decisionId: 9, probabilities: null },
        allowed,
      ).step,
    ).toBe('escalate');
    expect(
      cascadeAnswer(
        { choice: 'a_3', confidence: 1, decided: true, decisionId: 10, probabilities: null },
        allowed,
      ),
    ).toMatchObject({ step: 'escalate', choice: null });
    expect(cascadeAnswer(undefined, allowed).step).toBe('escalate');
  });
});
