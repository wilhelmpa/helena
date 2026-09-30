import {
  askByLogprobs,
  readAnswer,
  runDecisionEval,
  toSystemOne,
  type EvalReport,
} from '@helena/decisions';
import { GENERIC_EVAL } from '#modules/decisions/evals/generic';
import { TASK_TRIAGE_EVAL } from '#modules/decisions/evals/task-triage';

export interface NpuDecisionReadoutReport extends EvalReport {
  backend: string;
  timeoutMs: number;
  timeouts: EvalReport['errors'];
}

export class NpuDecisionReadoutError extends Error {
  constructor(public readonly report: NpuDecisionReadoutReport) {
    super(
      'NPU production decision readout failed its precision/coverage eval: ' +
        `${report.timeouts.length} timeouts, ${report.failures.length} decision failures, ` +
        `${report.errors.length} backend errors` +
        (report.errors.length ? ` (${report.errors[0]!.error})` : ''),
    );
    this.name = 'NpuDecisionReadoutError';
  }
}

export function npuDecisionTimeoutMs(
  backend: string,
  model: string,
  override?: number,
  configuration = process.env.VOLITION_NPU_DECISION_TIMEOUTS_MS,
): number {
  const configured = configuration
    ? (JSON.parse(configuration) as Record<string, Record<string, unknown>>)[backend]
    : undefined;
  const value = override ?? configured?.[model] ?? configured?.['*'] ?? 5_000;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new Error('NPU decision timeout must be a positive integer in milliseconds');
  return value;
}

export async function verifyNpuDecisionReadout(options: {
  baseUrl: string;
  key: string | null;
  model: string;
  classId: string;
  backend?: string;
  timeoutMs?: number;
}): Promise<NpuDecisionReadoutReport | null> {
  if (!['triage', 'decisions'].includes(options.classId)) return null;
  const backend = options.backend ?? 'fastflowlm';
  const timeoutMs = npuDecisionTimeoutMs(backend, options.model, options.timeoutMs);
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
            const signal = AbortSignal.timeout(timeoutMs);
            try {
              const response = await fetch(options.baseUrl.replace(/\/v1\/?$/, '') + path, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(options.key ? { Authorization: `Bearer ${options.key}` } : {}),
                },
                body: JSON.stringify(body),
                signal,
                redirect: 'error',
              });
              if (!response.ok) throw new Error(`NPU decision readout: HTTP ${response.status}`);
              return await response.json();
            } catch (error) {
              if (signal.aborted)
                throw new Error(`NPU decision readout timed out after ${timeoutMs} ms`);
              throw error;
            }
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
  const errorCases = new Set(report.errors.map((item) => item.case));
  const readout: NpuDecisionReadoutReport = {
    ...report,
    backend,
    model: options.model,
    timeoutMs,
    timeouts: report.errors.filter((item) =>
      item.error.startsWith('NPU decision readout timed out'),
    ),
    errors: report.errors.filter(
      (item) => !item.error.startsWith('NPU decision readout timed out'),
    ),
    failures: report.failures.filter((item) => !errorCases.has(item.case)),
  };
  if (!readout.passed) throw new NpuDecisionReadoutError(readout);
  return readout;
}
