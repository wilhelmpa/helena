import { t } from 'elysia';
import { agentRunTrigger, contextUsageBody, spendBody } from '../model';
import { runModelReport } from '../runtime-sync/model';
import { runFailure } from '#modules/model-availability/model';

export const MAX_RUN_OUTPUT_BYTES = 128 * 1024;

// The run handed to a runner (RunnerRun from the service). `prompt` is the framed
// task, `systemPrompt` the instructions about the run itself; a runner passes the
// first on stdin and the second to whatever its command calls a system prompt.
export const RunnerRunResponse = t.Object({
  id: t.Number(),
  trigger: agentRunTrigger,
  workClass: t.Nullable(t.String()),
  prompt: t.String(),
  systemPrompt: t.String(),
  attempts: t.Number(),
  claim: t.Number({
    description: 'Names this claim on the heartbeats, the result and a release of the run.',
  }),
  issueId: t.Nullable(t.Number()),
  issueIdentifier: t.Nullable(t.String()),
  projectId: t.Number(),
  sourceActivityId: t.Nullable(t.Number()),
  model: t.Nullable(t.String()),
  thinkingLevel: t.Nullable(t.String()),
  maxTurns: t.Nullable(t.Number()),
  runBudgetSeconds: t.Nullable(t.Number()),
  workdir: t.Nullable(t.String()),
  sessionId: t.Nullable(
    t.String({
      description:
        'The coding agent session to resume: the runner that held this run before died ' +
        'mid run and reported one. Null for a run claimed for the first time.',
    }),
  ),
  autopilotLevel: t.Integer({
    minimum: 0,
    maximum: 3,
    description:
      "The Autopilot level the run works at. Helena's policy engine decides every tool call " +
      "by it (POST /agent-policy/decide); a runner maps it onto its runtime's permission mode.",
  }),
});

// The claim result. The run is wrapped so an empty queue is an explicit null rather
// than an empty body.
export const ClaimResponse = t.Object({ run: t.Nullable(RunnerRunResponse) });

export const runParams = t.Object({ runId: t.Numeric() });

// The claim the runner holds, from the claimed run. With it the server refuses a
// heartbeat, result or release of a runner whose run was claimed again.
export const runClaimQuery = t.Object({
  claim: t.Optional(t.Numeric({ minimum: 1, description: 'The claim of the claimed run.' })),
});

export const releaseQuery = t.Object({
  claim: t.Numeric({ minimum: 1, description: 'The claim of the claimed run.' }),
});

export const sessionBody = t.Object({
  sessionId: t.String({
    minLength: 1,
    maxLength: 200,
    description: "The run's coding agent session, as soon as the runner reads it.",
  }),
});

// The heartbeat's answer. The server has no connection to the runner, so the cancel
// is returned on the call the runner already makes.
export const RunAckResponse = t.Object({
  canceled: t.Boolean({
    description:
      'The run was canceled, or claimed again after the named claim: kill the command ' +
      'and report nothing for it.',
  }),
  hold: t.Optional(
    t.Boolean({
      description:
        "The instance's emergency stop is on: stop the command and hand the run back; it " +
        'resumes its session once the stop is lifted.',
    }),
  ),
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
  sessionId: t.Optional(
    t.String({
      minLength: 1,
      maxLength: 200,
      description: "The agent's session of the run, which a reflection continues.",
    }),
  ),
  toolCalls: t.Optional(
    t.Integer({ minimum: 0, description: 'How many tool calls the agent made in the run.' }),
  ),
  spend: spendBody,
  runtime: t.Optional(runModelReport),
  failure: t.Optional(runFailure),
  escalation: t.Optional(
    t.Object(
      {
        target: t.String({ maxLength: 200 }),
        reason: t.String({ maxLength: 40 }),
        detail: t.Nullable(t.String({ maxLength: 200 })),
        handover: t.String({ maxLength: 20_000 }),
      },
      {
        description:
          "The task Helena's own loop handed to a bigger model: Helena queues the follow-up run.",
      },
    ),
  ),
});

// The answer to a run result: a reflection the runner starts in the run's session, or
// null. Plan decides it from the agent's settings and the run.
export const ResultResponse = t.Object({
  reflection: t.Nullable(
    t.Object({
      prompt: t.String(),
      maxTurns: t.Number(),
      runBudgetSeconds: t.Number(),
      model: t.Optional(
        t.Nullable(
          t.String({
            description:
              "The model the reflection runs on when it is not the run's: a local model " +
              '(`helena-<slug>/<id>`) Lokale KI hands it',
          }),
        ),
      ),
      thinkingLevel: t.Optional(
        t.Nullable(
          t.String({
            description:
              "The reflection's reasoning with that model: `none` runs it on the server's " +
              'provider without thinking',
          }),
        ),
      ),
    }),
  ),
});

// What the agent saved in a reflection, one entry per memory or skill write that succeeded.
export const reflectionSaved = t.Object({
  tool: t.Union([t.Literal('memory'), t.Literal('skill')]),
  action: t.String({ minLength: 1, maxLength: 40 }),
  target: t.String({ maxLength: 200 }),
});

export const reflectionBody = t.Object({
  status: t.Union([t.Literal('success'), t.Literal('failed')]),
  usage: contextUsageBody,
  spend: spendBody,
  saved: t.Array(reflectionSaved, { maxItems: 50 }),
  summary: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
  error: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
});
