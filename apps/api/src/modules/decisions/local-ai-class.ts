import type {
  DecisionQuestion,
  LocalAiEvalCaseResult,
  LocalAiEvalContext,
  LocalAiEvalResult,
  LocalAiTaskClass,
} from '@helena/sdk';
import { firstJson, withoutThinking } from '#modules/local-ai/evals';
import { GENERIC_EVAL_CASES } from './evals/generic';

// Typed decisions as a kind of work local AI takes (local-ai-platform.md §6.6 (a)): a decision
// connection "Lokale KI auf diesem Server" asks the model Lokale KI routes this class to, on the
// server it names, while the master switch and this class are on. The logit readout needs
// logprobs, which are verified on the GPU models only, hence the GPU as its unit.
export const LOCAL_AI_DECISIONS_CLASS = 'decisions';

const SYSTEM =
  'You answer one typed question about a text. Reply with a JSON object {"choice": "<id>"} ' +
  'whose value is exactly one of the option ids given, and nothing else.';

function optionsOf(question: DecisionQuestion): { id: string; label: string }[] {
  return question.kind === 'yesno'
    ? [
        { id: 'yes', label: 'yes' },
        { id: 'no', label: 'no' },
      ]
    : (question.options ?? []);
}

// Lokale KI's gate for this class: the general decision set (24 German cases, one question
// each), asked as a JSON answer — the eval context offers chat, not logprobs. Decisions' own
// evals (Home → Entscheidungen) then measure the logit readout per class on the connection.
export async function evaluateDecisions(context: LocalAiEvalContext): Promise<LocalAiEvalResult> {
  const cases: LocalAiEvalCaseResult[] = [];
  let tokens = 0;
  let seconds = 0;
  for (const item of GENERIC_EVAL_CASES) {
    for (const [id, question] of Object.entries(item.questions)) {
      const options = optionsOf(question);
      const answer = await context.chat({
        system: SYSTEM,
        prompt: JSON.stringify({
          text: item.context,
          question: question.question,
          options: options.map((option) => ({ id: option.id, option: option.label })),
        }),
        json: true,
        maxTokens: 200,
      });
      tokens += answer.outputTokens ?? 0;
      seconds += answer.latencyMs / 1000;
      const got = String(firstJson(withoutThinking(answer.text))?.choice ?? '').trim();
      const expected = [item.expected[id] ?? []].flat();
      const passed = expected.includes(got);
      cases.push({
        id: `${item.id}.${id}`,
        passed,
        detail: passed ? null : `expected ${expected.join(' or ')}, got ${got.slice(0, 60) || '–'}`,
        latencyMs: answer.latencyMs,
      });
    }
  }
  const latencies = cases
    .map((entry) => entry.latencyMs ?? null)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  return {
    score: cases.length ? cases.filter((entry) => entry.passed).length / cases.length : 0,
    cases,
    latencyMsP50: latencies.length ? latencies[Math.floor(latencies.length / 2)]! : null,
    tokensPerSecond: seconds > 0 ? tokens / seconds : null,
  };
}

export const DECISIONS_LOCAL_AI_CLASS: LocalAiTaskClass = {
  id: LOCAL_AI_DECISIONS_CLASS,
  label: { i18n: 'localAi.classes.decisions.label' },
  description: { i18n: 'localAi.classes.decisions.description' },
  unit: 'gpu',
  capability: 'chat',
  // They block the start of a run or a chat answer (the model router), so they go first.
  priority: 'interactive',
  // One option id as the answer, like the production calls (packages/decisions sends
  // enable_thinking false too).
  thinking: 'off',
  inMasterDefault: false,
  wired: true,
  evaluate: evaluateDecisions,
  threshold: 0.85,
};
