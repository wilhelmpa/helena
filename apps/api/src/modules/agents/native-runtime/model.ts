import { learnedSkill } from '../learning/model';
import { t } from 'elysia';

// Request and response shapes of Helena's own agent loop (runtime `helena`): its sessions and
// memory, reached with the agent's own key, and the fact store every runtime reaches through
// Helena's MCP server.

export const sessionParams = t.Object({ sessionId: t.String({ minLength: 36, maxLength: 36 }) });

export const createSessionBody = t.Object({
  kind: t.Union([t.Literal('run'), t.Literal('chat'), t.Literal('reflection')]),
  model: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
  runId: t.Optional(t.Nullable(t.Integer({ minimum: 1 }))),
  threadId: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
});

export const SessionIdResponse = t.Object({ id: t.String() });

export const SessionResponse = t.Object({
  id: t.String(),
  summary: t.Nullable(t.String()),
  compactedThrough: t.Integer(),
  items: t.Array(
    t.Object({
      seq: t.Integer(),
      step: t.Integer(),
      message: t.Unknown({ description: 'An AI SDK ModelMessage' }),
    }),
  ),
});

export const appendItemsBody = t.Object({
  items: t.Array(
    t.Object({
      seq: t.Integer({ minimum: 1 }),
      step: t.Integer({ minimum: 0 }),
      message: t.Unknown(),
      text: t.String({ maxLength: 40_000 }),
    }),
    { maxItems: 200 },
  ),
});

export const compactionBody = t.Object({
  summary: t.String({ minLength: 1, maxLength: 40_000 }),
  compactedThrough: t.Integer({ minimum: 0 }),
});

export const OkResponse = t.Object({ ok: t.Boolean() });

export const MemoryStateResponse = t.Object({
  files: t.Array(t.Object({ file: t.String(), content: t.String(), sha256: t.String() })),
  notes: t.Array(t.Object({ day: t.String(), content: t.String() })),
  approval: t.Boolean(),
});

export const noteBody = t.Object({
  text: t.String({ minLength: 1, maxLength: 4000 }),
  sessionId: t.Optional(t.String({ format: 'uuid' })),
});

export const memoryProposalBody = t.Object({
  file: t.Union([t.Literal('MEMORY.md'), t.Literal('USER.md')]),
  content: t.String({ maxLength: 20_000 }),
  reason: t.Optional(t.String({ maxLength: 1000 })),
  sessionId: t.Optional(t.String({ format: 'uuid' })),
});

export const MemoryProposalResponse = t.Object({
  status: t.Union([t.Literal('applied'), t.Literal('pending')]),
});

export const NotesResponse = t.Array(
  t.Object({
    day: t.String(),
    content: t.String(),
    updatedAt: t.String(),
    sourceContext: t.Nullable(t.Unknown()),
  }),
);

const factView = t.Object({
  id: t.Integer(),
  content: t.String(),
  category: t.String(),
  tags: t.Array(t.String()),
  entities: t.Array(t.String()),
  trust: t.Number(),
  project: t.Nullable(t.String()),
  confirmations: t.Integer(),
  helpful: t.Integer(),
  unhelpful: t.Integer(),
  contradictedBy: t.Nullable(t.Integer()),
  updatedAt: t.String(),
  score: t.Optional(t.Number()),
});

export const FactListResponse = t.Array(factView);

export const factStoreBody = t.Object({
  action: t.Union(
    [
      t.Literal('add'),
      t.Literal('search'),
      t.Literal('probe'),
      t.Literal('related'),
      t.Literal('reason'),
      t.Literal('contradict'),
      t.Literal('update'),
      t.Literal('remove'),
      t.Literal('list'),
    ],
    {
      description:
        'add: keep a fact (content, optional entities/category/tags/project). search: hybrid search (query). ' +
        'probe: facts about an entity. related: facts connected to an entity. reason: facts about all of several entities. ' +
        'contradict: pairs of facts that may contradict each other. update/remove: a fact by id. list: by trust.',
    },
  ),
  content: t.Optional(t.String({ maxLength: 2000, description: 'The fact, one short sentence.' })),
  entities: t.Optional(
    t.Array(t.String({ maxLength: 80 }), {
      maxItems: 12,
      description: 'Names the fact is about (people, projects, products, places).',
    }),
  ),
  entity: t.Optional(t.String({ maxLength: 80 })),
  category: t.Optional(t.String({ maxLength: 40 })),
  tags: t.Optional(t.Array(t.String({ maxLength: 40 }), { maxItems: 12 })),
  query: t.Optional(t.String({ maxLength: 500 })),
  id: t.Optional(t.Integer({ minimum: 1 })),
  project: t.Optional(
    t.String({ maxLength: 20, description: 'The project key the fact belongs to.' }),
  ),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 50 })),
  minTrust: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
});

export const FactStoreResponse = t.Object({
  status: t.Optional(t.String()),
  fact: t.Optional(factView),
  facts: t.Optional(t.Array(factView)),
  contradicts: t.Optional(
    t.Array(
      t.Object({
        id: t.Integer(),
        content: t.String(),
        shared: t.Array(t.String()),
        score: t.Number(),
      }),
    ),
  ),
  contradictions: t.Optional(
    t.Array(t.Object({ a: factView, b: factView, shared: t.Array(t.String()), score: t.Number() })),
  ),
  semantic: t.Optional(t.Boolean()),
  id: t.Optional(t.Integer()),
});

export const factParams = t.Object({ factId: t.Numeric() });
export const teamFactParams = t.Object({ teamId: t.Numeric(), factId: t.Numeric() });

export const factFeedbackBody = t.Object({
  helpful: t.Boolean({ description: 'Whether the fact helped: trust +0.05, or −0.10 when not.' }),
});

export const FactFeedbackResponse = t.Object({
  id: t.Integer(),
  oldTrust: t.Number(),
  trust: t.Number(),
});

export const factCorrectionBody = t.Object({
  content: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
  trust: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  category: t.Optional(t.String({ maxLength: 40 })),
});

export const RuntimesResponse = t.Object({
  helena: t.Boolean({ description: "Whether {appName}'s own agent loop can run an agent here." }),
});

export const nativeSkillWriteBody = t.Object({
  skill: learnedSkill,
  sessionId: t.Optional(t.String({ maxLength: 100 })),
  structured: t.Optional(t.Boolean()),
  baseRevision: t.Nullable(t.String({ pattern: '^[a-f0-9]{64}$' })),
});
export const NativeSkillResponse = t.Object({
  ...learnedSkill.properties,
  revision: t.String(),
  status: t.Optional(t.String()),
  change: t.Optional(t.Unknown()),
  history: t.Optional(t.Array(t.Unknown())),
  version: t.Optional(t.Number()),
  useCount: t.Optional(t.Number()),
  lastUsedAt: t.Optional(t.String()),
  createdAt: t.Optional(t.String()),
  proposed: t.Optional(t.Boolean()),
  pinned: t.Optional(t.Boolean()),
  archived: t.Optional(t.Boolean()),
  benefit: t.Optional(t.Union([t.Literal('useful'), t.Literal('no-benefit')])),
  comparison: t.Optional(
    t.Object({
      baselineSteps: t.Number(),
      loadedSteps: t.Number(),
      baselineSessionId: t.String(),
      loadedSessionId: t.String(),
    }),
  ),
});
export const NativeSkillsResponse = t.Array(NativeSkillResponse);

export const nativeReadBody = t.Union([
  t.Object({
    op: t.Literal('sessions.list'),
    limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
    offset: t.Optional(t.Integer({ minimum: 0 })),
  }),
  t.Object({
    op: t.Literal('sessions.search'),
    query: t.String({ minLength: 1, maxLength: 500 }),
    limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
  }),
  t.Object({
    op: t.Literal('sessions.transcript'),
    sessionId: t.String(),
    offset: t.Optional(t.Integer({ minimum: 0 })),
    limit: t.Optional(t.Integer({ minimum: 1, maximum: 500 })),
  }),
  t.Object({ op: t.Literal('curator.status') }),
  t.Object({ op: t.Literal('curator.run') }),
  t.Object({
    op: t.Literal('curator.set'),
    skill: t.String(),
    action: t.Union([t.Literal('pin'), t.Literal('unpin')]),
  }),
]);
export const NativeReadResponse = t.Unknown();

export const runtimeSelectionBody = t.Object({
  agentIds: t.Array(t.Integer({ minimum: 1 }), { minItems: 1, maxItems: 100, uniqueItems: true }),
  runtime: t.Union([
    t.Literal('helena'),
    t.Literal('hermes'),
    t.Literal('claude'),
    t.Literal('codex'),
  ]),
  apply: t.Optional(t.Boolean({ default: false })),
  revision: t.Optional(t.String({ pattern: '^[a-f0-9]{64}$' })),
});
export const RuntimeSelectionResponse = t.Object({
  applied: t.Boolean(),
  revision: t.String(),
  runtime: t.String(),
  agentIds: t.Array(t.Number()),
  busyAgentIds: t.Array(t.Number()),
  rollback: t.Array(
    t.Object({ agentId: t.Number(), model: t.Nullable(t.String()), runtimePolicy: t.Unknown() }),
  ),
});

export const profileImportBody = t.Object({
  sourceKey: t.String({ minLength: 1, maxLength: 200 }),
  apply: t.Optional(t.Boolean({ default: false })),
  memory: t.Array(
    t.Object({
      file: t.Union([t.Literal('MEMORY.md'), t.Literal('USER.md')]),
      content: t.String({ maxLength: 16384 }),
    }),
    { maxItems: 2 },
  ),
  skills: t.Array(learnedSkill, { maxItems: 100 }),
  sessions: t.Array(
    t.Object({
      id: t.String({ minLength: 1, maxLength: 200 }),
      kind: t.Union([t.Literal('run'), t.Literal('chat'), t.Literal('reflection')]),
      model: t.Nullable(t.String({ maxLength: 200 })),
      runId: t.Optional(t.Integer({ minimum: 1 })),
      threadId: t.Optional(t.String({ maxLength: 200 })),
      startedAt: t.String({ format: 'date-time' }),
      updatedAt: t.String({ format: 'date-time' }),
      items: t.Array(
        t.Object({
          role: t.Union([
            t.Literal('system'),
            t.Literal('user'),
            t.Literal('assistant'),
            t.Literal('tool'),
          ]),
          content: t.Union([t.String({ maxLength: 524288 }), t.Array(t.Any(), { maxItems: 100 })]),
          text: t.String({ maxLength: 20000 }),
          timestamp: t.String({ format: 'date-time' }),
        }),
        { maxItems: 10000 },
      ),
    }),
    { maxItems: 1000 },
  ),
});
export const ProfileImportResponse = t.Object({
  applied: t.Boolean(),
  unchanged: t.Boolean(),
  memory: t.Number(),
  skills: t.Number(),
  sessions: t.Array(t.Object({ sourceId: t.String(), sessionId: t.String() })),
});

export const nativeSkillUseBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 128 }),
  sessionId: t.Optional(t.String({ format: 'uuid' })),
});
export const nativeSkillReviewBody = t.Object({
  path: t.String({ minLength: 1, maxLength: 260 }),
  revision: t.String({ pattern: '^[a-f0-9]{64}$' }),
  action: t.Union([
    t.Literal('approve'),
    t.Literal('reject'),
    t.Literal('restore'),
    t.Literal('revert'),
  ]),
  version: t.Optional(t.Integer({ minimum: 1 })),
});

export const nativeSkillListQuery = t.Object({ includeArchived: t.Optional(t.Literal('true')) });

export const followupMode = t.Union([
  t.Literal('inject'),
  t.Literal('after'),
  t.Literal('replace'),
]);
export const followupBody = t.Object({
  id: t.String({ format: 'uuid' }),
  mode: followupMode,
  prompt: t.String({ minLength: 1, maxLength: 20000 }),
});
export const FollowupResponse = t.Object({
  id: t.String(),
  mode: followupMode,
  state: t.Union([t.Literal('pending'), t.Literal('applied'), t.Literal('queued')]),
  prompt: t.String(),
  nextId: t.Nullable(t.Integer()),
  position: t.Optional(t.Object({ sessionId: t.String(), seq: t.Integer(), step: t.Integer() })),
});
export const FollowupsResponse = t.Object({
  modes: t.Array(followupMode),
  items: t.Array(FollowupResponse),
});
export const nativeFollowupBody = t.Object({
  kind: t.Union([t.Literal('chat'), t.Literal('run')]),
  id: t.Integer({ minimum: 1 }),
  claim: t.Integer({ minimum: 1 }),
  sessionId: t.Optional(t.String({ format: 'uuid' })),
  afterSeq: t.Optional(t.Integer({ minimum: 0 })),
  step: t.Optional(t.Integer({ minimum: 1 })),
});
export const NativeFollowupsResponse = t.Object({
  pending: t.Boolean(),
  replace: t.Boolean(),
  items: t.Array(
    t.Object({
      seq: t.Integer(),
      step: t.Integer(),
      message: t.Object({ role: t.Literal('user'), content: t.String() }),
    }),
  ),
});

export const MessageInjectedEvent = t.Object({
  type: t.Literal('CUSTOM'),
  name: t.Literal('message_injected'),
  value: FollowupResponse,
});
export type MessageInjectedEventBody = typeof MessageInjectedEvent.static;
