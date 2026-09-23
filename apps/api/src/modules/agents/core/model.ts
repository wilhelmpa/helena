import { t } from 'elysia';

import { agentRunTrigger, maxTurnsLimit, runBudgetSecondsLimit, runContextTokens } from '../model';
import { instructionsRuntimeFile } from '../runtime-files/model';

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

// Body of the interactive run endpoints. threadId continues a conversation when the
// agent has memory enabled; omit it to start a new thread (the id used is returned in
// the response).
export const runBody = t.Object({
  prompt: t.String({ minLength: 1, description: 'Message to send the agent.' }),
  threadId: t.Optional(
    t.String({ description: 'Thread id from an earlier run, to continue that conversation.' }),
  ),
});

// A username is a short handle used to address the agent; keep it URL/mention safe.
const username = t.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-zA-Z0-9._-]+$',
  description: 'Mention handle (letters, digits, . _ -).',
});

export const runtimePolicy = t.Object({
  reasoningEffort: t.Nullable(t.String({ maxLength: 32 })),
  toolAllow: t.Array(t.String({ minLength: 1, maxLength: 160 }), { maxItems: 256 }),
  toolDeny: t.Array(t.String({ minLength: 1, maxLength: 160 }), {
    maxItems: 256,
    description:
      "Hermes toolsets the agent may not use in chats and runs, from its runtime state's " +
      'inventory. MCP servers stay available.',
  }),
  mcpGrants: t.Array(t.String({ minLength: 1, maxLength: 160 }), { maxItems: 256 }),
  files: t.Array(instructionsRuntimeFile, { maxItems: 32 }),
  // Defaults for every queued run of the agent; a chat answer is not limited.
  maxTurns: t.Optional(t.Nullable(t.Integer(maxTurnsLimit))),
  runBudgetSeconds: t.Optional(t.Nullable(t.Integer(runBudgetSecondsLimit))),
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
            "one of Plan's skills, 'agent' was created by the agent.",
        },
      ),
    }),
    { maxItems: 300 },
  ),
  memory: t.Array(
    t.Object({
      file: t.Union([t.Literal('MEMORY.md'), t.Literal('USER.md')]),
      content: t.String({ maxLength: 16384 }),
      truncated: t.Boolean(),
    }),
    { maxItems: 2 },
  ),
});

export const runtimeState = t.Object({
  adapter: t.Nullable(t.String()),
  status: t.Union([t.Literal('offline'), t.Literal('online'), t.Literal('degraded')]),
  appliedRevision: t.Nullable(t.String()),
  capabilities: t.Array(t.String()),
  detail: t.Nullable(t.String()),
  conflicts: t.Array(runtimeConflict),
  inventory: t.Nullable(runtimeInventory),
  reportedAt: t.Nullable(t.String()),
});

// Agent configuration, all optional so a config can be filled in over time. External
// agents use model as an Hermes model ref and runtimePolicy for host-owned controls;
// modelCredentialId/temperature/maxSteps remain internal-only.
const configFields = {
  modelCredentialId: t.Optional(
    t.Nullable(
      t.Number({
        description:
          'Credential id of the LLM provider, from list_integration_credentials. Required for an ' +
          'internal agent to run.',
      }),
    ),
  ),
  model: t.Optional(
    t.Nullable(
      t.String({
        description:
          "Model id the provider offers, from list_provider_models, e.g. 'claude-sonnet-5'.",
      }),
    ),
  ),
  instructions: t.Optional(t.Nullable(t.String({ description: 'System prompt for the agent.' }))),
  tools: t.Optional(
    t.Array(t.String(), {
      description:
        'Built-in action keys from list_ai_agent_tools the agent is granted. Tools on an ' +
        'integration are granted separately, through set_ai_agent_configured_tools.',
    }),
  ),
  temperature: t.Optional(t.Nullable(t.Number({ description: 'Sampling temperature.' }))),
  maxSteps: t.Optional(t.Nullable(t.Integer({ description: 'Max tool-call steps per run.' }))),
  memoryEnabled: t.Optional(
    t.Boolean({ description: 'Keep conversation memory across a thread.' }),
  ),
  memoryLastMessages: t.Optional(
    t.Nullable(t.Integer({ minimum: 1, description: 'How many recent messages to recall.' })),
  ),
  runtimePolicy: t.Optional(runtimePolicy),
  triggerOnMention: t.Optional(
    t.Boolean({
      description:
        'Run when @-mentioned, replied to, or when a human comments on an issue still delegated to the agent.',
    }),
  ),
  triggerOnAssign: t.Optional(t.Boolean({ description: 'Run when assigned to an issue.' })),
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
  projectIds: t.Optional(
    t.Array(t.Integer(), {
      description:
        'Projects of the team the agent works in, from list_projects. Replaces the set: a ' +
        'project left out is detached. A project of another team is rejected. The agent ' +
        "joins on the team's default role; set_member_role changes it per project.",
    }),
  ),
  runnerScope: t.Optional(
    t.Union([t.Literal('owner'), t.Literal('team')], {
      description:
        "Which runs an external agent's runner receives: 'owner' only the creator's, " +
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
  kind: t.Union([t.Literal('external'), t.Literal('internal')]),
  modelCredentialId: t.Nullable(t.Number()),
  model: t.Nullable(t.String()),
  instructions: t.Nullable(t.String()),
  tools: t.Array(t.String()),
  temperature: t.Nullable(t.Number()),
  maxSteps: t.Nullable(t.Number()),
  memoryEnabled: t.Boolean(),
  memoryLastMessages: t.Nullable(t.Number()),
  runtimePolicy,
  runtimeState,
  triggerOnMention: t.Boolean(),
  triggerOnAssign: t.Boolean(),
  fieldTriggers: t.Array(t.Object({ fieldId: t.Number(), name: t.String(), delaySec: t.Number() })),
  delegationDelaySec: t.Number(),
  ownerUserId: t.Nullable(t.String()),
  runnerScope: t.Union([t.Literal('owner'), t.Literal('team')]),
  template: t.Boolean(),
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
  modelProvider: t.Nullable(t.String()),
  actionCount: t.Number(),
  skillCount: t.Number(),
  toolCount: t.Number(),
});

// createAgent's result: the agent plus its one-time API key secret (null for an
// internal agent, which has no key).
export const CreateAgentResponse = t.Object({
  agent: AiAgentResponse,
  apiKey: t.Nullable(t.String()),
});

// The new API key secret returned once by regenerate-key.
export const RegenerateKeyResponse = t.Object({ apiKey: t.String() });

// A run's generated text and the conversation thread id (null when memory is off).
export const RunAgentResponse = t.Object({
  text: t.String(),
  threadId: t.Nullable(t.String()),
});

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
  nextAttemptAt: t.String(),
  createdAt: t.String(),
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
        "The coding agent session an external agent's runner keeps for this thread on its " +
        'own machine. Always null for an internal agent, which runs in this process.',
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
    }),
  ),
  nextPage: t.Nullable(t.Number()),
  activeAnswer: t.Optional(
    t.Object({
      messageId: t.Number(),
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
  kind: t.Union([t.Literal('external'), t.Literal('internal')], {
    description: "'external' (API key) or 'internal' (in-process, needs a model config).",
  }),
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

export const updateAgentBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  username: t.Optional(username),
  ...configFields,
});

// The team agent list, optionally narrowed to the agents working in one project.
export const agentListQuery = t.Object({
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
