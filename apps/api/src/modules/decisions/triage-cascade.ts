import type { DecidedQuestion } from './service';

export type TriageStep = 'act' | 'suggest' | 'escalate';

export function cascadeAnswer(
  answer: DecidedQuestion | undefined,
  allowed: readonly string[],
  mediumThreshold = 0.6,
): {
  step: TriageStep;
  choice: string | null;
  confidence: number | null;
  decisionId: number | null;
} {
  const choice = answer?.choice;
  const valid = choice && choice !== 'none' && allowed.includes(choice);
  return {
    step:
      valid && answer?.decided
        ? 'act'
        : valid && (answer?.confidence ?? 0) >= mediumThreshold
          ? 'suggest'
          : 'escalate',
    choice: valid ? choice : null,
    confidence: answer?.confidence ?? null,
    decisionId: answer?.decisionId ?? null,
  };
}
