import type { DecisionQuestion } from '@helena/sdk';
import type { AskResult } from '#modules/decisions/service';

export function browserQuestions(input: Record<string, unknown>): Record<string, DecisionQuestion> {
  return Object.fromEntries(
    Object.entries(input).map(([id, value]) => {
      if (!value || typeof value !== 'object') throw new Error('Invalid browser question.');
      const question = value as {
        type?: unknown;
        instructions?: unknown;
        criteria?: Record<string, unknown>;
      };
      const text =
        typeof question.instructions === 'string'
          ? question.instructions
          : JSON.stringify(question.instructions);
      if (!text) throw new Error('Missing browser question instructions.');
      if (question.type === 'noul')
        return [id, { kind: 'yesno', question: text } satisfies DecisionQuestion];
      if (question.type !== 'choice' || !question.criteria || Array.isArray(question.criteria))
        throw new Error('Invalid browser choice.');
      return [
        id,
        {
          kind: 'choice',
          question: text,
          options: Object.entries(question.criteria).map(([id, value]) => ({
            id,
            label: typeof value === 'string' ? value : JSON.stringify(value),
          })),
        } satisfies DecisionQuestion,
      ];
    }),
  );
}

export function browserDecisionConfident(result: AskResult, threshold: number): boolean {
  const operation = result.answers.operation;
  const target =
    operation &&
    (
      {
        CLICK: 'click_target',
        TYPE_TEXT: 'type_target',
        SELECT: 'select_target',
        PRESS_ENTER: 'enter_target',
      } as Record<string, string>
    )[operation.choice];
  const required = operation
    ? [
        'operation',
        ...(target ? [target] : []),
        ...(operation.choice === 'TYPE_TEXT' && result.answers.value ? ['value'] : []),
      ]
    : Object.keys(result.answers);
  return (
    required.length > 0 &&
    required.every((id) => (result.answers[id]?.confidence ?? 0) >= threshold)
  );
}
