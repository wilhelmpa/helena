import { askByLogprobs, readAnswer, runDecisionEval, toSystemOne } from '@helena/decisions';
import { GENERIC_EVAL } from '#modules/decisions/evals/generic';
import { TASK_TRIAGE_EVAL } from '#modules/decisions/evals/task-triage';

export async function verifyNpuDecisionReadout(options: {
  baseUrl: string;
  key: string | null;
  model: string;
  classId: string;
}): Promise<void> {
  if (!['triage', 'decisions'].includes(options.classId)) return;
  const report = await runDecisionEval(
    options.classId === 'triage' ? TASK_TRIAGE_EVAL : GENERIC_EVAL,
    0.85,
    async (context, questions) => {
      const started = Date.now();
      const result = await askByLogprobs(
        {
          model: options.model,
          concurrency: 1,
          async post(path, body) {
            const response = await fetch(options.baseUrl.replace(/\/v1\/?$/, '') + path, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(options.key ? { Authorization: `Bearer ${options.key}` } : {}),
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(5_000),
              redirect: 'error',
            });
            if (!response.ok) throw new Error(`NPU decision readout: HTTP ${response.status}`);
            return response.json();
          },
        },
        { state: context, questions: toSystemOne(questions) },
      );
      return {
        ...result,
        answers: Object.fromEntries(
          Object.entries(questions).map(([id, question]) => [
            id,
            readAnswer(question, result.answers[id]),
          ]),
        ),
        latencyMs: Date.now() - started,
      };
    },
    { concurrency: 1 },
  );
  if (!report.passed)
    throw new Error('NPU production decision readout failed its precision/coverage eval');
}
