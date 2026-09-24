import { t } from 'elysia';

export { agentParams } from '../model';

const skillPath = t.String({
  minLength: 1,
  maxLength: 260,
  description: "The skill's directory in the agent's runtime, from its inventory.",
});

const memoryFile = t.Union([t.Literal('MEMORY.md'), t.Literal('USER.md')]);

const sha256 = t.String({ pattern: '^[a-f0-9]{64}$' });

export const learnedSkillQuery = t.Object({ path: skillPath });

export const promoteLearnedSkillBody = t.Object({ path: skillPath });

// A skill the agent created, as its runner reported it.
export const learnedSkill = t.Object({
  path: skillPath,
  name: t.String({ minLength: 1, maxLength: 128 }),
  markdown: t.String({ maxLength: 65536 }),
  files: t.Array(
    t.Object({
      path: t.String({ minLength: 1, maxLength: 512 }),
      content: t.String({ maxLength: 65536 }),
    }),
    { maxItems: 16 },
  ),
  otherFiles: t.Integer({
    minimum: 0,
    description: "Files Helena's skill library does not hold, such as scripts.",
  }),
  truncated: t.Boolean({ description: 'Too large to report, so its content is left out.' }),
});

export const LearnedSkillResponse = learnedSkill;

export const createRuntimeActionBody = t.Union([
  t.Object({ kind: t.Literal('discard-skill'), path: skillPath }),
  t.Object({ kind: t.Literal('pin-skill'), path: skillPath, pinned: t.Boolean() }),
  t.Object({
    kind: t.Literal('write-memory'),
    file: memoryFile,
    content: t.String({ maxLength: 16384 }),
    baseSha256: t.String({
      pattern: '^[a-f0-9]{64}$',
      description: 'The sha256 of the memory file the edit was made on, from the inventory.',
    }),
  }),
]);

export const RuntimeActionResponse = t.Object({
  id: t.Number(),
  kind: t.Union([
    t.Literal('discard-skill'),
    t.Literal('pin-skill'),
    t.Literal('write-memory'),
    t.Literal('rewrite-profile'),
  ]),
  target: t.String({ description: 'The skill path, or the memory file.' }),
  pinned: t.Nullable(t.Boolean()),
  error: t.Nullable(
    t.String({ description: 'Why the runner could not carry it out. Null while it waits.' }),
  ),
  createdAt: t.String(),
});

export const RuntimeActionListResponse = t.Array(RuntimeActionResponse);

// What the runner hands back for each action of the revision it applied.
export const runtimeActionResult = t.Object({
  id: t.Integer(),
  error: t.Nullable(t.String({ maxLength: 500 })),
});

// The pending actions as the runner receives them with the policy. 'rewrite-profile' is
// "Neu schreiben": the runner writes the agent's whole profile again and reads it back.
export const runtimeActionSnapshot = t.Union([
  t.Object({ id: t.Number(), kind: t.Literal('rewrite-profile') }),
  t.Object({ id: t.Number(), kind: t.Literal('discard-skill'), path: t.String() }),
  t.Object({
    id: t.Number(),
    kind: t.Literal('pin-skill'),
    path: t.String(),
    pinned: t.Boolean(),
  }),
  t.Object({
    id: t.Number(),
    kind: t.Literal('write-memory'),
    file: memoryFile,
    content: t.String(),
    baseSha256: sha256,
  }),
]);
