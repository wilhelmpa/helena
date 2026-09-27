import type { LocalizedText } from './text';

// Typed decisions (docs/helena-decisions/decisions.md): a question with declared options,
// answered by a decision backend (registry `decisionBackends`) with a probability per option,
// in milliseconds, instead of a text answer. Helena asks them for its own features (which
// model tier a request needs, how to sort a mail, which bank transaction a receipt belongs
// to) and offers them to agents (MCP tool `decide`) and workflows (step "Entscheidung").
//
// A decision is always advice: below the class's confidence threshold, on a timeout or an
// error, the caller does what it did before (its default). Nothing a decision says is
// carried out unchecked where it writes: the caller's own policy and approvals apply.
//
// A decision class (registry `decisionClasses`) is one kind of question a feature asks: it
// names the questions, what may be stored of the input, whether the input may leave the
// machine, its default threshold and failsafe, and the labelled cases it has to pass before
// the owner can switch it on. Where it is answered (backend, model, threshold) is the
// owner's choice per team, in Helena's settings.

export type DecisionKind = 'choice' | 'yesno';

export interface DecisionOption {
  // Stable id, returned as the choice. Lowercase letters, digits, `-`, `_`, `.`, `:`.
  id: string;
  // What the option means, in the words a model reads (the System One `criteria`).
  label: string;
}

export interface DecisionQuestion {
  kind: DecisionKind;
  // What to decide, in plain words; about the context the caller passes.
  question: string;
  // `choice`: 2–50 options. `yesno`: none (the answer is `yes` or `no`).
  options?: DecisionOption[];
}

export interface DecisionAnswer {
  // An option id, or `yes` / `no`.
  choice: string;
  // Per option id (or yes/no), summing to 1.
  probabilities: Record<string, number>;
  // 0–1: how sure the answer is, from the spread of the distribution
  // ((n·p_max − 1) / (n − 1), Helena's measure); for yes/no max(p, 1 − p) scaled the same way.
  // This is separate from a System One provider's reported confidence.
  confidence: number;
}

// Why a decision was or was not taken. Only `decided` means the caller may use the choice.
export type DecisionStatus =
  | 'decided'
  // Answered, but below the class's threshold: the caller's default happens.
  | 'unsure'
  // The class is off (or not allowed here): nothing was asked.
  | 'off'
  // No backend could be asked (none configured, local AI switched off, cloud not allowed).
  | 'no_backend'
  // The failsafe ran out.
  | 'timeout'
  | 'error';

export const DECISION_STATUSES: readonly DecisionStatus[] = [
  'decided',
  'unsure',
  'off',
  'no_backend',
  'timeout',
  'error',
];

// One labelled case of a class's eval: a context (German, like the owner's data), the
// questions the feature asks about it, and the right answer per question (several where
// more than one is right).
export interface DecisionEvalCase {
  id: string;
  context: string;
  questions: Record<string, DecisionQuestion>;
  expected: Record<string, string | string[]>;
}

export interface DecisionEvalSet {
  cases: DecisionEvalCase[];
  // The share of the answers above the threshold that must be right (precision), and the
  // share of all answers that must be above it (coverage), for the class to pass.
  minPrecision: number;
  minCoverage: number;
}

export interface DecisionClass {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  // What may happen to the input (the context and the question): whether the owner may let
  // the decision log keep it (`never`: only a hash), and whether it may go to a cloud
  // backend at all (`never`: local backends only, e.g. private mail).
  input: { store: 'never' | 'optional'; cloud: 'allowed' | 'never' };
  defaults: {
    // Below this confidence the caller's default happens.
    threshold: number;
    // The failsafe: an answer later than this counts as none.
    timeoutMs: number;
  };
  // The class may only be switched on once its newest eval on the chosen backend passed.
  eval?: DecisionEvalSet;
}

// The confidence of a distribution: 1 when everything sits on one option, 0 when it is flat.
export function decisionConfidence(probabilities: Record<string, number>): number {
  const values = Object.values(probabilities).filter((value) => Number.isFinite(value));
  const n = values.length;
  if (n < 2) return n === 1 ? 1 : 0;
  const max = Math.max(...values);
  return Math.max(0, Math.min(1, (n * max - 1) / (n - 1)));
}

const OPTION_ID = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

export function isDecisionOptionId(value: string): boolean {
  return OPTION_ID.test(value);
}

// The options of a question as the backend gets them: `yes`/`no` for a yes/no question.
export function decisionOptionIds(question: DecisionQuestion): string[] {
  return question.kind === 'yesno' ? ['yes', 'no'] : (question.options ?? []).map((o) => o.id);
}

// A problem with a question a caller or plugin passes, or null when it can be asked.
export function decisionQuestionProblem(question: DecisionQuestion): string | null {
  if (!question.question?.trim()) return 'the question is empty';
  if (question.question.length > 2000) return 'the question is longer than 2000 characters';
  if (question.kind === 'yesno') return question.options?.length ? 'yes/no takes no options' : null;
  if (question.kind !== 'choice') return 'kind must be choice or yesno';
  const options = question.options ?? [];
  if (options.length < 2 || options.length > 50) return 'a choice needs 2 to 50 options';
  const ids = new Set<string>();
  for (const option of options) {
    if (!isDecisionOptionId(option.id)) return `invalid option id "${option.id.slice(0, 40)}"`;
    if (ids.has(option.id)) return `option "${option.id}" is listed twice`;
    ids.add(option.id);
    if (!option.label?.trim() || option.label.length > 500)
      return `option "${option.id}" needs a label of at most 500 characters`;
  }
  return null;
}
