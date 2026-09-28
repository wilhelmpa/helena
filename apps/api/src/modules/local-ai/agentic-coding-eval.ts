import {
  median,
  type LocalAiEvalCaseResult,
  type LocalAiEvalContext,
  type LocalAiEvalResult,
} from '@helena/sdk';
import { CODING_TASKS } from '../../scripts/agentic-coding/tasks';

export async function evaluateAgenticCoding(
  context: LocalAiEvalContext,
): Promise<LocalAiEvalResult> {
  if (!context.runCodingTask) throw new Error('Hermes coding eval runner is not configured');
  const cases: LocalAiEvalCaseResult[] = [];
  let tokens = 0;
  let seconds = 0;
  for (const task of CODING_TASKS) {
    const run = await context.runCodingTask(task.id);
    tokens += run.outputTokens;
    seconds += run.durationMs / 1000;
    cases.push({
      id: task.id,
      passed: run.testsPassed && !run.aborted,
      detail: `tests ${run.testsPassed ? 'passed' : 'failed'}; tools ${run.validToolCalls}/${run.toolCalls}; loops ${run.loops}; aborted ${run.aborted}; duration ${run.durationMs}ms; tokens ${run.inputTokens}/${run.outputTokens}`,
      latencyMs: run.durationMs,
    });
  }
  return {
    score: cases.filter((item) => item.passed).length / cases.length,
    cases,
    latencyMsP50: median(cases.map((item) => item.latencyMs ?? NaN)),
    tokensPerSecond: seconds > 0 && tokens > 0 ? tokens / seconds : null,
  };
}
