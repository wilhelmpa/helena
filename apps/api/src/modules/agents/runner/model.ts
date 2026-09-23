import { t } from 'elysia';
import { agentRunTrigger, contextUsageBody } from '../model';

export const MAX_RUN_OUTPUT_BYTES = 128 * 1024;

// The run handed to a runner (RunnerRun from the service). `prompt` is the framed
// task, `systemPrompt` the instructions about the run itself; a runner passes the
// first on stdin and the second to whatever its command calls a system prompt.
export const RunnerRunResponse = t.Object({
  id: t.Number(),
  trigger: agentRunTrigger,
  prompt: t.String(),
  systemPrompt: t.String(),
  attempts: t.Number(),
  issueId: t.Nullable(t.Number()),
  issueIdentifier: t.Nullable(t.String()),
  sourceActivityId: t.Nullable(t.Number()),
  model: t.Nullable(t.String()),
  thinkingLevel: t.Nullable(t.String()),
  maxTurns: t.Nullable(t.Number()),
  runBudgetSeconds: t.Nullable(t.Number()),
  workdir: t.Nullable(t.String()),
});

// The claim result. The run is wrapped so an empty queue is an explicit null rather
// than an empty body.
export const ClaimResponse = t.Object({ run: t.Nullable(RunnerRunResponse) });

export const runParams = t.Object({ runId: t.Numeric() });

// The attempt count of the claim the runner holds, from the claimed run. With it the
// server refuses a heartbeat, result or release of a runner whose run was claimed again.
export const runAttemptQuery = t.Object({
  attempt: t.Optional(t.Numeric({ minimum: 1, description: 'The attempts of the claimed run.' })),
});

export const releaseQuery = t.Object({
  attempt: t.Numeric({ minimum: 1, description: 'The attempts of the claimed run.' }),
});

// The heartbeat's answer. The server has no connection to the runner, so the cancel
// is returned on the call the runner already makes.
export const RunAckResponse = t.Object({
  canceled: t.Boolean({
    description:
      'The run was canceled, or claimed again after the named attempt: kill the command ' +
      'and report nothing for it.',
  }),
});

export const resultBody = t.Object({
  status: t.Union([t.Literal('success'), t.Literal('failed')], {
    description: 'Whether the run completed or failed.',
  }),
  output: t.Optional(
    t.Nullable(
      t.String({
        maxLength: MAX_RUN_OUTPUT_BYTES,
        description: 'What the run produced, for history (at most 128 KiB UTF-8).',
      }),
    ),
  ),
  error: t.Optional(t.Nullable(t.String({ description: 'Why the run failed.' }))),
  usage: contextUsageBody,
});
