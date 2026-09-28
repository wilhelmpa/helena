// The contract between the loop (loop.ts) and a decision policy (policy-jev.ts):
// one round turns an observation into a planned action plus the signals the loop decides its
// status on. A policy only asks questions and reads answers; the loop owns timing, guards,
// budgets, Helena's policy and the browser.

import type { PageDiff } from './page-diff.ts';
import type { DecisionReply, DecisionRequest } from './systemone.ts';
import type {
  Operation,
  PageElement,
  PageObservation,
  PolicyKind,
  TaskCandidate,
  TaskMode,
  TaskSuccess,
} from './types.ts';

export interface HistoryEntry {
  action?: string;
  element?: string;
  // The key of the value typed; `text` stays local and is omitted from decision requests.
  value?: string;
  text?: string;
  option?: string;
  outcome?: string;
  page_changed?: boolean;
  event?: string;
}

export interface RoundInput {
  observation: PageObservation;
  goal: string;
  success?: TaskSuccess;
  values: Record<string, string>;
  mode: TaskMode;
  round: number;
  history: HistoryEntry[];
  lastChange?: PageDiff;
  // Elements a guard refused this task (a checkbox already in the requested state).
  excluded: ReadonlySet<number>;
}

export interface RoundAnswer {
  operation: Operation;
  element: PageElement | null;
  // The key of the caller's values the round chose, when it chose one.
  valueKey?: string;
  // The dropdown option the round chose with its element.
  option?: string;
  optionIndex?: number;
  operationProbability: number;
  operationConfidence: number;
  targetProbability: number;
  // P(yes) of the status questions a policy asked; null when it did not ask.
  done: number | null;
  error: number | null;
  login: number | null;
  blocked: number | null;
  irreversible: number | null;
  candidates: TaskCandidate[];
}

export type Ask = (request: DecisionRequest) => Promise<DecisionReply>;

export interface DecisionPolicy {
  kind: PolicyKind;
  // Below this probability of its target a targeted action is not taken (the task comes back
  // with its candidates instead).
  minTarget: number;
  round(input: RoundInput, ask: Ask): Promise<RoundAnswer>;
  // The option of a dropdown, when no value names one.
  pickOption(input: RoundInput, element: PageElement, ask: Ask): Promise<string | null>;
  // Which value goes into a field, when the round did not say.
  pickValue(input: RoundInput, element: PageElement, ask: Ask): Promise<string | null>;
}

// A value that names one of a dropdown's options (case and spacing ignored), if any.
export function optionFromValues(
  element: PageElement,
  values: Record<string, string>,
): string | null {
  const options = element.options ?? [];
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  for (const value of Object.values(values)) {
    const wanted = norm(value);
    const exact = options.filter((option) => norm(option) === wanted);
    if (exact.length === 1) return exact[0]!;
  }
  for (const value of Object.values(values)) {
    const wanted = norm(value);
    if (wanted.length < 2) continue;
    const partial = options.filter((option) => norm(option).includes(wanted));
    if (partial.length === 1) return partial[0]!;
  }
  return null;
}

export function topCandidates(
  probabilities: Record<string, number>,
  byKey: (key: string) => PageElement | undefined,
  describe: (element: PageElement) => string,
  n = 3,
): TaskCandidate[] {
  return Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .flatMap(([key, probability]) => {
      const element = byKey(key);
      return element
        ? [{ element: describe(element), probability: Math.round(probability * 100) / 100 }]
        : [];
    });
}
