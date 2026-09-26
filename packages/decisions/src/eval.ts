import type { DecisionAnswer, DecisionEvalSet, DecisionQuestion } from '@helena/sdk';

// The eval of a decision class (docs/helena-decisions/decisions.md §5): every labelled case is
// asked as the feature would ask it, and the answers are scored against the labels by code,
// never by a model. What counts is the answers above the threshold (the ones a feature acts
// on): their precision, and how many of the answers get there (coverage). A class passes when
// both reach what its eval set asks for.

export interface EvalAskResult {
  answers: Record<string, DecisionAnswer>;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
}

export type EvalAsk = (
  context: string,
  questions: Record<string, DecisionQuestion>,
) => Promise<EvalAskResult>;

export interface EvalFailure {
  case: string;
  question: string;
  expected: string[];
  got: string | null;
  confidence: number | null;
}

export interface EvalQuestionScore {
  questions: number;
  answered: number;
  correct: number;
  correctAnswered: number;
}

export interface EvalReport {
  threshold: number;
  questions: number;
  answered: number;
  correct: number;
  correctAnswered: number;
  // Right above the threshold / answered above it (null when nothing got there).
  precision: number | null;
  coverage: number;
  accuracy: number;
  passed: boolean;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  failures: EvalFailure[];
  byQuestion: Record<string, EvalQuestionScore>;
  // Precision and coverage at other thresholds, to choose one.
  sweep: { threshold: number; precision: number | null; coverage: number }[];
  // Cases the backend could not answer at all.
  errors: { case: string; error: string }[];
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index]!);
}

const SWEEP = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];

export async function runDecisionEval(
  set: DecisionEvalSet,
  threshold: number,
  ask: EvalAsk,
  options: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<EvalReport> {
  const scored: { case: string; question: string; ok: boolean; confidence: number }[] = [];
  const failures: EvalFailure[] = [];
  const errors: EvalReport['errors'] = [];
  const latencies: number[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let model: string | null = null;
  let next = 0;
  const worker = async () => {
    while (next < set.cases.length) {
      if (options.signal?.aborted) return;
      const item = set.cases[next++]!;
      let result: EvalAskResult;
      try {
        result = await ask(item.context, item.questions);
      } catch (error) {
        errors.push({
          case: item.id,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
        });
        for (const [question, expected] of Object.entries(item.expected)) {
          scored.push({ case: item.id, question, ok: false, confidence: 0 });
          failures.push({
            case: item.id,
            question,
            expected: [expected].flat(),
            got: null,
            confidence: null,
          });
        }
        continue;
      }
      latencies.push(result.latencyMs);
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
      model = result.model ?? model;
      for (const [question, expected] of Object.entries(item.expected)) {
        const answer = result.answers[question];
        const wanted = [expected].flat();
        const ok = !!answer && wanted.includes(answer.choice);
        scored.push({ case: item.id, question, ok, confidence: answer?.confidence ?? 0 });
        if (!ok || (answer?.confidence ?? 0) < threshold) {
          failures.push({
            case: item.id,
            question,
            expected: wanted,
            got: answer?.choice ?? null,
            confidence: answer ? Math.round(answer.confidence * 1000) / 1000 : null,
          });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 2) }, () => worker()));

  const at = (t: number) => {
    const above = scored.filter((entry) => entry.confidence >= t);
    return {
      answered: above.length,
      correctAnswered: above.filter((entry) => entry.ok).length,
    };
  };
  const byQuestion: Record<string, EvalQuestionScore> = {};
  for (const entry of scored) {
    const score = (byQuestion[entry.question] ??= {
      questions: 0,
      answered: 0,
      correct: 0,
      correctAnswered: 0,
    });
    score.questions += 1;
    if (entry.ok) score.correct += 1;
    if (entry.confidence >= threshold) {
      score.answered += 1;
      if (entry.ok) score.correctAnswered += 1;
    }
  }
  const main = at(threshold);
  const questions = scored.length;
  const correct = scored.filter((entry) => entry.ok).length;
  const precision = main.answered > 0 ? main.correctAnswered / main.answered : null;
  const coverage = questions > 0 ? main.answered / questions : 0;
  return {
    threshold,
    questions,
    answered: main.answered,
    correct,
    correctAnswered: main.correctAnswered,
    precision,
    coverage,
    accuracy: questions > 0 ? correct / questions : 0,
    passed:
      precision !== null &&
      precision >= set.minPrecision &&
      coverage >= set.minCoverage &&
      errors.length === 0,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    inputTokens,
    outputTokens,
    model,
    failures: failures.slice(0, 200),
    byQuestion,
    sweep: SWEEP.map((t) => {
      const point = at(t);
      return {
        threshold: t,
        precision: point.answered > 0 ? point.correctAnswered / point.answered : null,
        coverage: questions > 0 ? point.answered / questions : 0,
      };
    }),
    errors,
  };
}
