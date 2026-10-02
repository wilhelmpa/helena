import { t } from 'elysia';

import { agentRunTrigger, maxTurnsLimit, runBudgetSecondsLimit, runContextTokens } from '../model';
import { instructionsRuntimeFile } from '../runtime-files/model';
import {
  modelCheck,
  profileReport,
  runtimeAccount,
  runtimeIssue,
  runtimeSandbox,
} from '../runtime-sync/model';
import { modelRoute } from '#modules/model-router/model';
import { runFailure } from '#modules/model-availability/model';

export { agentParams, projectAgentParams } from '../model';

export const threadParams = t.Object({
  projectKey: t.String(),
  agentId: t.Numeric(),
  threadId: t.String(),
});

export const teamThreadParams = t.Object({
  teamId: t.Numeric(),
  agentId: t.Numeric(),
  threadId: t.String(),
});

// A username is a short handle used to address the agent; keep it URL/mention safe.
const username = t.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-zA-Z0-9._-]+$',
  description: 'Mention handle (letters, digits, . _ -).',
});

// The field groups a template copy follows (template-sync.ts): Skills, Tools, MCP
// servers, approval rules, instructions, model + reasoning, and budgets.
export const templateFieldGroup = t.Union([
  t.Literal('skills'),
  t.Literal('tools'),
  t.Literal('mcpServers'),
  t.Literal('approvals'),
  t.Literal('instructions'),
  t.Literal('model'),
  t.Literal('budgets'),
]);

export const runtimePolicy = t.Object({
  reasoningEffort: t.Nullable(t.String({ maxLength: 32 })),
  toolAllow: t.Array(t.String({ minLength: 1, maxLength: 160 }), { maxItems: 256 }),
  toolDeny: t.Array(t.String({ minLength: 1, maxLength: 160 }), {
    maxItems: 256,
    description:
      'Hermes toolsets and MCP servers of the Hermes configuration the agent may not use in ' +
      "chats and runs, from its runtime state's inventory.",
  }),
  mcpGrants: t.Array(t.String({ minLength: 1, maxLength: 160 }), { maxItems: 256 }),
  files: t.Array(instructionsRuntimeFile, { maxItems: 32 }),
  // Defaults for every queued run of the agent; a chat answer is not limited.
  maxTurns: t.Optional(t.Nullable(t.Integer(maxTurnsLimit))),
  runBudgetSeconds: t.Optional(t.Nullable(t.Integer(runBudgetSecondsLimit))),
  learning: t.Optional(
    t.Boolean({
      description:
        'Whether the agent keeps memory and creates skills in its runtime. Unset, it does.',
    }),
  ),
  curator: t.Optional(
    t.Boolean({
      description:
        "Whether the runtime's curator may archive skills the agent created and no longer " +
        'uses. Unset, it may not.',
    }),
  ),
  runtime: t.Optional(
    t.Union(
      [
        t.Literal('hermes'),
        t.Literal('claude'),
        t.Literal('codex'),
        t.Literal('command'),
        t.Literal('webhook'),
        t.Literal('helena'),
      ],
      {
        description:
          "Which runtime runs the agent. Unset is Hermes. {appName} is {appName}'s own agent loop " +
          '(local and API-key models), available while HELENA_NATIVE_RUNTIME is on. Unset is Hermes. The server provisions a runtime for ' +
          'an agent of one project whichever it is. Command runs a workspace script; Webhook ' +
          'posts a signed request to an external service. Claude Code and Codex also receive ' +
          'managed instructions, skills, tools, models and granted runtime logins.',
      },
    ),
  ),
  escalation: t.Optional(
    t.Object({
      target: t.Optional(t.Union([t.Literal('claude'), t.Literal('codex')])),
      model: t.Nullable(t.String({ maxLength: 200 })),
      afterFailures: t.Integer({ minimum: 0, maximum: 5 }),
      onResumeLimit: t.Boolean(),
      onRequest: t.Boolean(),
      maxDepth: t.Integer({ minimum: 0, maximum: 1 }),
    }),
  ),
  helena: t.Optional(
    t.Object(
      {
        chatBudgetSeconds: t.Optional(
          t.Integer({
            minimum: 60,
            maximum: 7200,
            description: 'Zeitgrenze für Chats in Sekunden (Standard 900).',
          }),
        ),
        chatBudgetBehavior: t.Optional(
          t.Union([t.Literal('summarize'), t.Literal('fail')], {
            description:
              'Bei Zeitgrenze abschließend ohne Werkzeuge antworten (Standard summarize) oder fehlschlagen.',
          }),
        ),
        chatSummarySeconds: t.Optional(
          t.Integer({
            minimum: 5,
            maximum: 180,
            description:
              'Zusätzliche Zeit für den Abschluss ohne Werkzeuge (Standard 60 Sekunden).',
          }),
        ),
        toolProfile: t.Optional(
          t.Union(
            [
              t.Literal('assistent'),
              t.Literal('recherche'),
              t.Literal('coder-lite'),
              t.Literal('voll'),
            ],
            {
              description: 'The tools of the role (docs/helena-decisions/zentrale-laufzeit.md §6).',
            },
          ),
        ),
        escalation: t.Optional(
          t.Object({
            mode: t.Optional(t.Union([t.Literal('auto'), t.Literal('never'), t.Literal('always')])),
            target: t.Optional(
              t.Nullable(
                t.String({
                  maxLength: 160,
                  description:
                    'A model the loop drives (`anthropic/claude-sonnet-5`) or `runtime:claude[/model]`, `runtime:codex[/model]`.',
                }),
              ),
            ),
            taskKinds: t.Optional(t.Array(t.String({ maxLength: 40 }), { maxItems: 20 })),
            confidenceBelow: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
            onFailure: t.Optional(t.Boolean()),
          }),
        ),
        browserBudgetSeconds: t.Optional(t.Integer({ minimum: 30, maximum: 3600 })),
        localModelQueueSeconds: t.Optional(t.Integer({ minimum: 0, maximum: 86_400 })),
      },
      { description: "Settings of {appName}'s own loop (runtime helena)." },
    ),
  ),
  commandScript: t.Optional(
    t.String({
      minLength: 1,
      maxLength: 256,
      pattern: '^(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))[A-Za-z0-9_./-]+$',
    }),
  ),
  webhookUrl: t.Optional(t.String({ minLength: 1, maxLength: 2048, pattern: '^https://[^\\s]+$' })),
  webhookSecretEnv: t.Optional(
    t.String({ minLength: 1, maxLength: 128, pattern: '^[A-Z_][A-Z0-9_]*$' }),
  ),
  reflection: t.Optional(
    t.Union([t.Literal('off'), t.Literal('failure'), t.Literal('complex')], {
      description:
        'When a learning agent reflects on a run in a short follow-up turn of the same ' +
        "session: 'failure' after a failed run and after rework on an issue, 'complex' also " +
        "after a run of many tool calls. Unset, 'complex'.",
    }),
  ),
  memoryApproval: t.Optional(
    t.Boolean({
      description:
        "Whether the agent's own memory writes wait for the owner's approval as a proposal " +
        'with a diff. Unset, they take effect without approval.',
    }),
  ),
  contextLimits: t.Optional(
    t.Partial(
      t.Object({
        memory: t.Integer({ minimum: 1, maximum: 500000 }),
        user: t.Integer({ minimum: 1, maximum: 500000 }),
        dailyNote: t.Integer({ minimum: 1, maximum: 500000 }),
        soul: t.Integer({ minimum: 1, maximum: 500000 }),
        agentInstructions: t.Integer({ minimum: 1, maximum: 500000 }),
        projectInstructions: t.Integer({ minimum: 1, maximum: 500000 }),
        teamInstructions: t.Integer({ minimum: 1, maximum: 500000 }),
        skillDescription: t.Integer({ minimum: 1, maximum: 500000 }),
        loadedSkills: t.Integer({ minimum: 1, maximum: 100 }),
      }),
    ),
  ),
  skillsDisabled: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 128 }), {
      maxItems: 300,
      description: "Skills of the agent's runtime turned off by name (Hermes skills.disabled).",
    }),
  ),
  compression: t.Optional(
    t.Object(
      {
        thresholdTokens: t.Optional(
          t.Integer({
            minimum: 16_000,
            maximum: 1_000_000,
            description:
              "Compress once a call's context reaches this many tokens. Unset, the " +
              "instance's default.",
          }),
        ),
        targetRatio: t.Optional(
          t.Number({
            minimum: 0.1,
            maximum: 0.5,
            description: 'What the compressed context keeps, as a share of the threshold.',
          }),
        ),
        idleCompactMinutes: t.Optional(
          t.Integer({
            minimum: 0,
            maximum: 10_080,
            description: 'Compress a session resumed after this many idle minutes; 0 never.',
          }),
        ),
        model: t.Optional(
          t.Object({
            provider: t.String({ minLength: 1, maxLength: 100 }),
            model: t.String({ minLength: 1, maxLength: 200 }),
          }),
        ),
      },
      { description: 'How Hermes compresses a long conversation. Unset fields take the defaults.' },
    ),
  ),
  chatReflection: t.Optional(
    t.Boolean({
      description:
        'Whether a learning agent reflects on its chats once they go quiet. Unset, it does.',
    }),
  ),
  chatReflectionIdleMinutes: t.Optional(
    t.Integer({
      minimum: 2,
      maximum: 1440,
      description: 'Minutes a chat stays quiet before the agent reflects on it. Unset, 10.',
    }),
  ),
  chatReflectionEveryTurns: t.Optional(
    t.Integer({
      minimum: 2,
      maximum: 200,
      description:
        "The person's messages after which the agent reflects even while the chat goes on. " +
        'Unset, 20.',
    }),
  ),
  fallbackModels: t.Optional(
    t.Nullable(
      t.Array(
        t.Object({
          provider: t.String({ minLength: 1, maxLength: 100 }),
          model: t.String({ minLength: 1, maxLength: 200 }),
        }),
        {
          maxItems: 8,
          description:
            "Models the runtime falls back to, in order, when the agent's model fails. " +
            "Unset, the instance's default list.",
        },
      ),
    ),
  ),
});

// A managed file the runtime found changed outside Plan. The runtime kept a copy and
// wrote Plan's version; the changed content is shown so it can be taken over.
export const runtimeConflict = t.Object({
  path: t.String({ minLength: 1, maxLength: 200 }),
  content: t.String({ maxLength: 65536 }),
});

const inventoryName = t.String({ minLength: 1, maxLength: 128 });

// What the agent can do in its runtime, as the runner reads it: the Hermes toolsets and
// MCP servers of its profile, its skills and its memory. Hermes owns all of it, so Plan
// only shows it.
export const runtimeInventory = t.Object({
  toolsets: t.Array(inventoryName, { maxItems: 64 }),
  mcpServers: t.Array(inventoryName, { maxItems: 64 }),
  skills: t.Array(
    t.Object({
      name: inventoryName,
      category: t.Nullable(inventoryName),
      description: t.String({ maxLength: 300 }),
      origin: t.Union(
        [t.Literal('bundled'), t.Literal('hub'), t.Literal('plan'), t.Literal('agent')],
        {
          description:
            "'bundled' ships with Hermes, 'hub' was installed from the Skills Hub, 'plan' is " +
            "one of {appName}'s skills, 'agent' was created by the agent.",
        },
      ),
      path: t.Optional(
        t.String({
          minLength: 1,
          maxLength: 260,
          description: "The skill's directory in the runtime, which an action names it by.",
        }),
      ),
      pinned: t.Optional(t.Boolean()),
    }),
    { maxItems: 300 },
  ),
  memory: t.Array(
    t.Object({
      file: t.Union([t.Literal('MEMORY.md'), t.Literal('USER.md')]),
      content: t.String({ maxLength: 16384 }),
      truncated: t.Boolean(),
      sha256: t.Optional(
        t.String({
          pattern: '^[a-f0-9]{64}$',
          description: 'Of the whole file; an edit names the version it was made on.',
        }),
      ),
      chars: t.Optional(t.Integer({ minimum: 0 })),
    }),
    { maxItems: 2 },
  ),
  cronJobs: t.Optional(
    t.Integer({ minimum: 0, description: "Jobs in the runtime's own scheduler." }),
  ),
});

export const runtimeState = t.Object({
  adapter: t.Nullable(t.String()),
  status: t.Union([t.Literal('offline'), t.Literal('online'), t.Literal('degraded')]),
  appliedRevision: t.Nullable(t.String()),
  capabilities: t.Array(t.String()),
  detail: t.Nullable(t.String()),
  conflicts: t.Array(runtimeConflict),
  restored: t.Array(t.String(), {
    description:
      'What the runtime put back after it was changed or removed outside {appName}: managed ' +
      'files and plugin links, by their path in the runtime.',
  }),
  inventory: t.Nullable(runtimeInventory),
  profile: t.Nullable(profileReport),
  version: t.Nullable(t.String()),
  issues: t.Array(runtimeIssue),
  sandbox: t.Nullable(runtimeSandbox),
  account: t.Nullable(runtimeAccount),
  reportedAt: t.Nullable(t.String()),
});

// Agent configuration, all optional so a config can be filled in over time. model is
// the model ref the agent's runtime runs on and runtimePolicy the host-owned controls
// its runner projects into that runtime.
const configFields = {
  model: t.Optional(
    t.Nullable(
      t.String({
        description:
          "Model ref the agent's runtime runs on, from its runner's model catalog; null runs " +
          "the runtime's own default.",
      }),
    ),
  ),
  instructions: t.Optional(t.Nullable(t.String({ description: 'System prompt for the agent.' }))),
  runtimePolicy: t.Optional(runtimePolicy),
  triggerOnMention: t.Optional(
    t.Boolean({
      description:
        'Run when @-mentioned, replied to, or when a human comments on an issue still delegated to the agent.',
    }),
  ),
  triggerOnAssign: t.Optional(t.Boolean({ description: 'Run when assigned to an issue.' })),
  heartbeatIntervalMinutes: t.Optional(t.Nullable(t.Integer({ minimum: 5, maximum: 10080 }))),
  heartbeatTimezone: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  heartbeatDays: t.Optional(
    t.Array(t.Integer({ minimum: 0, maximum: 6 }), { minItems: 1, maxItems: 7 }),
  ),
  heartbeatStart: t.Optional(t.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' })),
  heartbeatEnd: t.Optional(t.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' })),
  heartbeatInstructions: t.Optional(t.String({ maxLength: 16000 })),
  fieldTriggers: t.Optional(
    t.Array(
      t.Object({
        fieldId: t.Integer(),
        delaySec: t.Integer({ minimum: 0, maximum: 86400 }),
      }),
      {
        description:
          'Member custom fields (from list_custom_fields) the agent also reacts to: being set ' +
          'into one of them starts a run after delaySec seconds. Other fields are ignored.',
      },
    ),
  ),
  delegationDelaySec: t.Optional(
    t.Integer({
      minimum: 0,
      maximum: 86400,
      description: 'Seconds a delegation run waits before the agent may pick it up.',
    }),
  ),
  maxConcurrentChats: t.Optional(
    t.Integer({
      minimum: 1,
      maximum: 20,
      description:
        "How many of the agent's chats a member may leave answering at once. A send past " +
        'the limit is refused (409) until one of the running answers finishes.',
    }),
  ),
  projectIds: t.Optional(
    t.Array(t.Integer(), {
      description:
        'Projects of the team the agent works in, from list_projects. Replaces the set: a ' +
        'project left out is detached. A project of another team is rejected. The agent ' +
        "joins on the team's default role; set_member_role changes it per project.",
    }),
  ),
  projectScope: t.Optional(
    t.Union([t.Literal('selected'), t.Literal('all')], {
      description:
        "'all' attaches the agent to every project of its team, including future projects; only a team owner or manager may set it.",
    }),
  ),
  runnerScope: t.Optional(
    t.Union([t.Literal('owner'), t.Literal('team')], {
      description:
        "Which runs the agent's runner receives: 'owner' only the creator's, " +
        "'team' any member's.",
    }),
  ),
  template: t.Optional(
    t.Boolean({
      description:
        'A template runs nowhere and works in no project: turning it on detaches the agent ' +
        'from every project. copy_ai_agent_template adds a copy of it to a project.',
    }),
  ),
};

// An agent DTO (AiAgentRow from the service).
export const AiAgentResponse = t.Object({
  id: t.Number(),
  teamId: t.Number(),
  sizeLimits: t.Optional(
    t.Record(
      t.Union([
        t.Literal('memory'),
        t.Literal('user'),
        t.Literal('dailyNote'),
        t.Literal('soul'),
        t.Literal('agentInstructions'),
        t.Literal('projectInstructions'),
      ]),
      t.Object({ used: t.Number(), limit: t.Number(), truncated: t.Boolean() }),
    ),
  ),
  agentRole: t.Union([t.Literal('agent'), t.Literal('home')]),
  projectScope: t.Union([t.Literal('selected'), t.Literal('all')]),
  projects: t.Array(
    t.Object({
      id: t.Number(),
      key: t.String(),
      name: t.String(),
      roleId: t.Nullable(t.Number()),
      roleName: t.Nullable(t.String()),
      instructions: t.String(),
    }),
    { description: 'The projects of the team the agent works in.' },
  ),
  userId: t.String(),
  name: t.String(),
  username: t.String(),
  kind: t.Literal('external', {
    description: 'Always external: a runner drives every agent with its API key.',
  }),
  model: t.Nullable(t.String()),
  instructions: t.Nullable(t.String()),
  runtimePolicy,
  runtimeState,
  triggerOnMention: t.Boolean(),
  triggerOnAssign: t.Boolean(),
  heartbeatIntervalMinutes: t.Nullable(t.Number()),
  heartbeatTimezone: t.String(),
  heartbeatDays: t.Array(t.Number()),
  heartbeatStart: t.String(),
  heartbeatEnd: t.String(),
  heartbeatInstructions: t.String(),
  heartbeatLastAt: t.Nullable(t.String()),
  heartbeatNextAt: t.Nullable(t.String()),
  fieldTriggers: t.Array(t.Object({ fieldId: t.Number(), name: t.String(), delaySec: t.Number() })),
  delegationDelaySec: t.Number(),
  maxConcurrentChats: t.Number(),
  ownerUserId: t.Nullable(t.String()),
  runnerScope: t.Union([t.Literal('owner'), t.Literal('team')]),
  template: t.Boolean(),
  sourceTemplateId: t.Nullable(
    t.Number({ description: 'The template this agent was copied from.' }),
  ),
  templateOverrides: t.Array(templateFieldGroup, {
    description: "Field groups this copy's owner changed by hand; a template sync skips them.",
  }),
  templateSyncedAt: t.Nullable(t.String()),
  dailyTokenCeiling: t.Nullable(t.Number()),
  monthlyTokenCeiling: t.Nullable(t.Number()),
  autopilotLevel: t.Nullable(
    t.Number({ description: "The agent's own Autopilot level; null follows the project." }),
  ),
  autopilotRaise: t.Boolean({ description: "Whether the agent's level may exceed its project's." }),
  lastSeenAt: t.Nullable(t.String()),
  pausedAt: t.Nullable(
    t.String({
      description:
        'When the agent was paused. A paused agent takes no new work: its queued runs and ' +
        'chat answers wait, and a mention or a delegation does not start it.',
    }),
  ),
  pauseReason: t.Nullable(t.String()),
  createdAt: t.String(),
  apiKeyStart: t.Nullable(t.String()),
  skillCount: t.Number(),
  toolCount: t.Number(),
});

// createAgent's result: the agent plus its one-time API key secret.
export const CreateAgentResponse = t.Object({
  agent: AiAgentResponse,
  apiKey: t.String(),
  modelFallback: t.Optional(
    t.Object(
      {
        model: t.String(),
        detail: t.Nullable(t.String()),
      },
      {
        description:
          'A copy of a template whose model the provider refused this account runs on its ' +
          "runtime's default model instead: the template's model and the provider's words.",
      },
    ),
  ),
});

// The new API key secret returned once by regenerate-key.
export const RegenerateKeyResponse = t.Object({ apiKey: t.String() });

// One row of an agent's run history (AgentRunRow from run-queue).
export const AgentRunResponse = t.Object({
  id: t.Number(),
  status: t.String(),
  trigger: agentRunTrigger,
  issueId: t.Nullable(t.Number()),
  issueIdentifier: t.Nullable(t.String()),
  issueTitle: t.Nullable(t.String()),
  prompt: t.String(),
  attempts: t.Number(),
  lastError: t.Nullable(t.String()),
  output: t.Nullable(t.String()),
  contextTokens: runContextTokens,
  blockedQuestion: t.Nullable(
    t.String({
      description:
        'The question the agent asked when it reported itself blocked during the run, which ' +
        'then ended as a success. Null for a run that was not blocked.',
    }),
  ),
  autopilotLevel: t.Nullable(
    t.Number({
      description:
        'The Autopilot level the run worked at (0 propose … 3 autonomous); null for a run ' +
        'from before the Autopilot.',
    }),
  ),
  reflection: t.Nullable(
    t.Object(
      {
        status: t.Union([
          t.Literal('pending'),
          t.Literal('success'),
          t.Literal('failed'),
          t.Literal('lost'),
        ]),
        reason: t.Union([t.Literal('failure'), t.Literal('rework'), t.Literal('complex')]),
        model: t.Optional(
          t.Nullable(
            t.String({
              description: "The local model it ran on when Lokale KI took it; absent: the run's",
            }),
          ),
        ),
        saved: t.Array(
          t.Object({
            tool: t.Union([t.Literal('memory'), t.Literal('skill')]),
            action: t.String(),
            target: t.String(),
          }),
        ),
        summary: t.Nullable(t.String()),
        error: t.Nullable(t.String()),
        tokens: t.Optional(t.Number()),
      },
      {
        description:
          "The follow-up turn in which the agent kept what the run taught it: 'lost' when " +
          "its runner never reported it. Its tokens are part of the run's. Null for a run " +
          'without one.',
      },
    ),
  ),
  modelCheck: t.Nullable(modelCheck),
  modelRoute: t.Optional(t.Nullable(modelRoute)),
  failure: t.Nullable(runFailure),
  nextAttemptAt: t.String(),
  createdAt: t.String(),
  archivedAt: t.Optional(
    t.Nullable(
      t.String({
        description: 'When the run was archived: it then leaves the lists. Null when not.',
      }),
    ),
  ),
});

// One page of an agent's runs (AgentRunPage from run-queue).
export const AgentRunPageResponse = t.Object({
  items: t.Array(AgentRunResponse),
  nextCursor: t.Nullable(t.Number()),
});

// One chat thread in the caller's history with an agent (ChatThreadSummary).
export const ChatThreadResponse = t.Object({
  id: t.String(),
  title: t.Nullable(t.String()),
  cliSessionId: t.Nullable(
    t.String({
      description:
        "The coding agent session the agent's runner keeps for this thread on its own " +
        'machine. Null until the runner has reported one.',
    }),
  ),
  model: t.Nullable(t.String()),
  thinkingLevel: t.Nullable(t.String()),
  contextTokens: t.Optional(
    t.Nullable(
      t.Number({
        description:
          'The tokens the last completed answer of this thread read and wrote, which is ' +
          'the size of its context. Absent while no answer has completed; null where the ' +
          'agent reports no counts that can be read as a context size.',
      }),
    ),
  ),
  favorite: t.Boolean({ description: 'Whether the caller starred this conversation.' }),
  snippet: t.Optional(
    t.String({ description: 'Search only: the text around the match in a message.' }),
  ),
  match: t.Optional(
    t.Union([t.Literal('title'), t.Literal('user'), t.Literal('assistant')], {
      description:
        "Search only: where the match was found — the title, the member's message, or the agent's reply.",
    }),
  ),
  createdAt: t.String(),
  updatedAt: t.String(),
});

// One piece of a message (ChatPart): a stretch of text, the model's reasoning, or a tool
// the agent called between two of them, with what it was given and what it answered where
// the agent reported them.
const ChatPartResponse = t.Union([
  t.Object({ type: t.Literal('text'), text: t.String() }),
  t.Object({ type: t.Literal('reasoning'), text: t.String() }),
  t.Object({
    type: t.Literal('tool'),
    toolCallId: t.String(),
    toolName: t.String(),
    args: t.Optional(t.String()),
    result: t.Optional(t.String()),
    isError: t.Optional(t.Boolean()),
  }),
]);

export const ChatAttachmentResponse = t.Union([
  t.Object({
    kind: t.Literal('file'),
    path: t.String({ description: 'Path relative to the vault.' }),
    name: t.String(),
    contentType: t.String(),
    sizeBytes: t.Number(),
  }),
  t.Object({
    kind: t.Literal('task'),
    issueId: t.Number(),
    identifier: t.String(),
    title: t.String(),
  }),
  t.Object({
    kind: t.Literal('knowledge'),
    ref: t.String(),
    title: t.String(),
    source: t.String(),
    href: t.String(),
    vaultPath: t.Optional(t.String()),
    contentType: t.Optional(t.String()),
  }),
]);

// One page of a chat thread's transcript (ChatMessagePage).
export const ChatMessagesResponse = t.Object({
  items: t.Array(
    t.Object({
      id: t.String(),
      role: t.Union([t.Literal('user'), t.Literal('assistant')]),
      parts: t.Array(ChatPartResponse),
      createdAt: t.String(),
      stopped: t.Optional(t.Boolean()),
      parentId: t.Optional(t.Nullable(t.String())),
      siblingIds: t.Optional(t.Array(t.String())),
      agentId: t.Optional(t.Number()),
      attachments: t.Optional(t.Array(ChatAttachmentResponse)),
      model: t.Optional(t.Nullable(t.String())),
      inputTokens: t.Optional(t.Nullable(t.Number())),
      outputTokens: t.Optional(t.Nullable(t.Number())),
      durationMs: t.Optional(t.Nullable(t.Number())),
      error: t.Optional(t.String()),
      errorCode: t.Optional(
        t.String({
          description:
            "Why the answer failed, where the runtime's words said ('model-unavailable': " +
            'the provider does not serve the model to this account).',
        }),
      ),
      errorModel: t.Optional(t.Nullable(t.String())),
      modelRoute: t.Optional(t.Nullable(modelRoute)),
      modelCheck: t.Optional(t.Nullable(modelCheck)),
      // A local model was asked for and the configured one answered (model check).
      localFallback: t.Optional(
        t.Object({
          from: t.String(),
          reason: t.Union([t.Literal('off'), t.Literal('down'), t.Literal('failed')]),
        }),
      ),
      // Said in the conversation mode (a question), or given by Helena's voice reply (an answer).
      via: t.Optional(t.Literal('voice')),
    }),
  ),
  nextPage: t.Nullable(t.Number()),
  activeAnswer: t.Optional(
    t.Object({
      messageId: t.Number(),
      agentId: t.Optional(t.Number()),
      status: t.Union([t.Literal('pending'), t.Literal('streaming')]),
      createdAt: t.String(),
    }),
  ),
});

export const AiAgentListResponse = t.Array(AiAgentResponse);

// One page of a caller's chat threads with an agent (ChatThreadPage).
export const ChatThreadListResponse = t.Object({
  items: t.Array(ChatThreadResponse),
  nextPage: t.Nullable(t.Number()),
});

export const createAgentBody = t.Object({
  name: t.String({ minLength: 1, description: 'Display name.' }),
  username,
  kind: t.Optional(
    t.Literal('external', {
      description: 'Always external, the one kind there is; may be left out.',
    }),
  ),
  ...configFields,
  projectId: t.Optional(
    t.Integer({
      description:
        'The project the agent is created in, in place of projectIds: it works in that ' +
        "project only, as a specialist reporting to the project's coordinator.",
    }),
  ),
});

export const copyTemplateBody = t.Object({
  projectId: t.Integer({ description: 'The project of the team the copy works in.' }),
});

export const saveAsTemplateBody = t.Object({
  name: t.Optional(
    t.String({
      maxLength: 128,
      description: "The template's name; the agent's name when it is left out.",
    }),
  ),
});

export const resetToTemplateBody = t.Object({
  group: templateFieldGroup,
});

export const updateAgentBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  username: t.Optional(username),
  ...configFields,
});

// The team agent list, optionally narrowed to the agents working in one project.
export const agentListQuery = t.Object({
  query: t.Optional(
    t.String({
      maxLength: 200,
      description:
        'Resolve an exact agent name, handle, or role plus project, such as PRIV-Koordinator. Ambiguous matches remain visible.',
    }),
  ),
  projectId: t.Optional(t.Numeric({ description: 'Only the agents working in this project.' })),
});

export const setAgentProjectsBody = t.Object({
  projectIds: t.Array(t.Integer(), {
    description:
      'Projects of the team the agent works in. Replaces the set: a project left out is ' +
      "detached. The agent joins on the team's default role; set_member_role changes it per " +
      'project.',
  }),
});

export const runsQuery = t.Object({
  before: t.Optional(t.Numeric()),
  limit: t.Optional(t.Numeric()),
  includeArchived: t.Optional(
    t.BooleanString({ description: 'Include archived runs (left out by default).' }),
  ),
});

export const agentRunParams = t.Object({
  teamId: t.Numeric(),
  agentId: t.Numeric({ description: 'Agent id from list_ai_agents.' }),
  runId: t.Numeric({ description: 'Run id from the run history.' }),
});

export const AgentRunArchiveResponse = t.Object({
  archivedAt: t.Nullable(t.String()),
});

export const renameThreadBody = t.Object({
  title: t.String({ minLength: 1, maxLength: 80, description: 'New title of the conversation.' }),
});

// Both the thread list and a thread's transcript are read a page at a time.
export const threadPageQuery = t.Object({ page: t.Optional(t.Numeric({ minimum: 0 })) });

// The history list also searches and shows the starred conversations. `favorites` is a
// group of its own: it is not paginated and ignores the page.
export const threadListQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 0 })),
  q: t.Optional(
    t.String({
      description:
        'Case-insensitive substring, matched against the thread title and the message text of ' +
        'both roles. Shorter than two characters searches nothing.',
    }),
  ),
  favorites: t.Optional(
    t.Boolean({ description: 'Return the starred conversations instead of the page.' }),
  ),
});

export const AgentDreamHistory = t.Array(
  t.Object({
    startedAt: t.String(),
    finishedAt: t.Nullable(t.String()),
    trigger: t.Union([t.Literal('manual'), t.Literal('schedule')]),
    status: t.Union([t.Literal('running'), t.Literal('succeeded'), t.Literal('failed')]),
    result: t.Optional(
      t.Object({
        status: t.String(),
        duplicates: t.Number(),
        conflicts: t.Number(),
        omitted: t.Number(),
        filtered: t.Number(),
      }),
    ),
    error: t.Optional(t.String()),
  }),
);
