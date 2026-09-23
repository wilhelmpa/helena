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
});

// The claim result. The run is wrapped so an empty queue is an explicit null rather
// than an empty body.
export const ClaimResponse = t.Object({ run: t.Nullable(RunnerRunResponse) });

export const runParams = t.Object({ runId: t.Numeric() });

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
