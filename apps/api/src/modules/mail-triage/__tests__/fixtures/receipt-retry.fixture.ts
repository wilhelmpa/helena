import { mock } from 'bun:test';
import assert from 'node:assert/strict';

globalThis.fetch = (() =>
  assert.fail('Provider/network calls forbidden')) as unknown as typeof fetch;
type Action = {
  kind: string;
  projectId?: number;
  receiptIds?: number[];
  note?: string | null;
  attemptedAt?: string;
};
type Row = {
  id: number;
  teamId: number;
  messageId: number;
  category: string;
  status: string;
  actions: Action[];
  correctedAt: Date | null;
};
type Context = {
  classification: Row;
  message: { id: number; accountId: number; threadId: number; deletedAt: null | Date };
  thread: { id: number; projectId: number | null };
  account: { id: number; enabled: boolean; credentialId: number | null };
};
type Expr = { op: string; args: unknown[] };
const field = (table: string, key: string) => ({ op: 'field', args: [table, key] });
const table = (name: string, keys: string[]) =>
  Object.assign({ name }, Object.fromEntries(keys.map((key) => [key, field(name, key)])));
const tables = {
  helenaMailClassification: table('classification', [
    'id',
    'teamId',
    'messageId',
    'category',
    'status',
    'actions',
  ]),
  mailMessage: table('message', ['id', 'accountId', 'threadId', 'deletedAt']),
  mailThread: table('thread', ['id', 'projectId']),
  mailAccount: table('account', ['id', 'enabled', 'credentialId']),
};
const rows: Context[] = [];
const empty: Action = {
  kind: 'receipt',
  projectId: 1,
  receiptIds: [],
  note: 'No supported receipt original found.',
};
function add(id: number): Context {
  const context: Context = {
    classification: {
      id,
      teamId: 1,
      messageId: id,
      category: 'invoice',
      status: 'classified',
      actions: [structuredClone(empty)],
      correctedAt: null,
    },
    message: { id, accountId: 4, threadId: id, deletedAt: null },
    thread: { id, projectId: 1 },
    account: { id: 4, enabled: true, credentialId: 1 },
  };
  rows.push(context);
  return context;
}
function value(expression: unknown, context: Context): unknown {
  if (!expression || typeof expression !== 'object' || !('op' in expression)) return expression;
  const { op, args } = expression as Expr;
  const read = (at: number) => value(args[at], context);
  if (op === 'field')
    return (context[args[0] as keyof Context] as unknown as Record<string, unknown>)[
      args[1] as string
    ];
  if (op === 'eq') return read(0) === read(1);
  if (op === 'and')
    return args.filter((arg) => arg !== undefined).every((arg) => value(arg, context));
  if (op === 'inArray') return (args[1] as unknown[]).includes(read(0));
  if (op === 'isNull') return read(0) === null;
  if (op === 'asc') return read(0);
  if (op === 'sql') {
    const source = args[0] as string;
    const parameters = args[1] as unknown[];
    const items = () => value(parameters[0], context) as Action[];
    if (source.includes('NOT EXISTS')) {
      const distinctEmpty = source.includes("IS DISTINCT FROM '[]'::jsonb");
      return !items().some(
        (action) =>
          action.kind === 'receipt' &&
          (!distinctEmpty || !Array.isArray(action.receiptIds) || action.receiptIds.length > 0),
      );
    }
    if (source.includes("max(action->>'attemptedAt')")) {
      return (
        items()
          .filter((action) => action.kind === 'receipt' || action.note === parameters[1])
          .map((action) => action.attemptedAt ?? '')
          .sort()
          .at(-1) ?? ''
      );
    }
    if (source.includes('IS NOT NULL')) return value(parameters[0], context) !== null;
    assert.fail(`Unsupported SQL in offline adapter: ${source}`);
  }
  assert.fail(`Unsupported operator ${op}`);
}
let locked = 0;
let skipRowLock = false;
let nextQueryError = false;
let beforeLock: (() => void) | undefined;
function select(fields?: Record<string, unknown>) {
  let predicate: unknown;
  let order: unknown[] = [];
  let limit = Infinity;
  let skipped = false;
  const execute = () => {
    if (nextQueryError) {
      nextQueryError = false;
      throw new Error('synthetic DB failure');
    }
    if (skipped) return [];
    return rows
      .filter((context) => predicate === undefined || value(predicate, context))
      .sort((a, b) => {
        for (const expression of order) {
          const av = value(expression, a) as string | number;
          const bv = value(expression, b) as string | number;
          if (av < bv) return -1;
          if (av > bv) return 1;
        }
        return 0;
      })
      .slice(0, limit)
      .map((context) =>
        fields && 'row' in fields
          ? { row: structuredClone(context.classification), projectId: context.thread.projectId }
          : fields && 'id' in fields
            ? { id: context.classification.id }
            : structuredClone(context.classification),
      );
  };
  const query = {
    from: () => query,
    innerJoin: () => query,
    where: (condition: unknown) => {
      predicate = condition;
      return query;
    },
    orderBy: (...expressions: unknown[]) => {
      order = expressions;
      return query;
    },
    limit: (count: number) => {
      limit = count;
      return query;
    },
    for: (kind: string, options: unknown) => {
      assert.equal(kind, 'update');
      assert.deepEqual(options, { skipLocked: true });
      skipped = skipRowLock;
      locked++;
      beforeLock?.();
      beforeLock = undefined;
      return query;
    },
    then: (resolve: (result: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve().then(execute).then(resolve, reject),
  };
  return query;
}
let tail = Promise.resolve();
const update = () => ({
  set: (patch: { actions: Action[] }) => ({
    where: async (condition: unknown) => {
      for (const context of rows)
        if (value(condition, context))
          context.classification.actions = structuredClone(patch.actions);
    },
  }),
});
type RetryDb = {
  select: typeof select;
  update: typeof update;
  transaction: <T>(body: (tx: RetryDb) => Promise<T>) => Promise<T>;
};
const db: RetryDb = {
  select,
  update,
  transaction: async <T>(body: (tx: RetryDb) => Promise<T>): Promise<T> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await body(db);
    } finally {
      release();
    }
  },
};
mock.module('@repo/db', () => ({
  ...tables,
  db,
  ...Object.fromEntries(
    [
      'aiAgent',
      'helenaDecisionClassSetting',
      'mailAttachment',
      'mailFolder',
      'mailMessageFolder',
      'mailThreadIssue',
      'project',
      'projectMember',
    ].map((name) => [name, table(name, ['id'])]),
  ),
}));
mock.module('drizzle-orm', () => ({
  ...Object.fromEntries(
    ['and', 'asc', 'desc', 'eq', 'gte', 'inArray', 'isNull', 'notExists', 'notInArray'].map(
      (op) => [op, (...args: unknown[]) => ({ op, args })],
    ),
  ),
  sql: (parts: TemplateStringsArray, ...args: unknown[]) => ({
    op: 'sql',
    args: [parts.join('?'), args],
  }),
}));
const moduleMock = (path: string, exports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).pathname, () => exports);
moduleMock('../../../../shared/lib.ts', { HttpError: class extends Error {}, iso: () => '' });
moduleMock('../../../decisions/classes.ts', { MAIL_CLASS: 'mail' });
moduleMock('../../../decisions/questions.ts', {
  MAIL_CATEGORIES: [],
  MAIL_PRIORITIES: [],
  NO_PROJECT: 'none',
  mailContext: () => assert.fail('No classifier'),
  mailQuestions: () => assert.fail('No classifier'),
  projectOptionId: () => assert.fail('No classifier'),
});
moduleMock('../../../decisions/service.ts', {
  decide: () => assert.fail('No model'),
  recordOutcome: () => assert.fail('No correction'),
});
moduleMock('../../../mail/threads/filing.ts', {
  createTaskFromThread: () => assert.fail('No task'),
});
moduleMock('../../../mail/threads/move.ts', { moveThread: () => assert.fail('No move') });
moduleMock('../../config.ts', {
  mailTriageConfig: () => assert.fail('No scheduler configuration'),
});
const { retryReceiptFiling, useReceiptIntake } = await import('../../classify');
const config = {
  project: 'off',
  task: 'off',
  agent: 'off',
  agentId: null,
  receipts: 'auto',
  accountIds: [4],
  since: null,
} as const;
const run = () =>
  retryReceiptFiling(1, { ...config, accountIds: [...config.accountIds] }, 'owner', 1);
const mode = process.argv[2];
let calls = 0;
if (mode === 'empty-success') {
  const context = add(1);
  context.classification.actions.unshift({ kind: 'task', note: 'Owner task unchanged' });
  let available = false;
  useReceiptIntake(async () => {
    calls++;
    return available ? [88] : [];
  });
  assert.deepEqual(await run(), { completed: 0, failed: 0 });
  assert.deepEqual(await run(), { completed: 0, failed: 0 });
  assert.equal(context.classification.actions.length, 2);
  assert.ok(context.classification.actions[1]!.attemptedAt);
  available = true;
  const result = await Promise.all(Array.from({ length: 10 }, () => run()));
  assert.equal(
    result.reduce((sum, row) => sum + row.completed, 0),
    1,
  );
  assert.equal(calls, 3);
  assert.deepEqual(await run(), { completed: 0, failed: 0 });
  assert.equal(context.classification.actions.length, 3);
  assert.equal(context.classification.actions[0]!.note, 'Owner task unchanged');
} else if (mode === 'fairness') {
  for (let id = 1; id <= 21; id++) add(id);
  const attempts: number[] = [];
  useReceiptIntake(async (input) => {
    attempts.push(input.messageId);
    return [];
  });
  assert.deepEqual(await run(), { completed: 0, failed: 0 });
  assert.equal(attempts.length, 20);
  attempts.length = 0;
  await run();
  assert.equal(attempts[0], 21);
  assert.ok(rows.every((context) => context.classification.actions.length === 1));
} else if (mode === 'owner-correction') {
  const context = add(1);
  beforeLock = () => {
    context.classification.category = 'notification';
    context.classification.correctedAt = new Date();
  };
  useReceiptIntake(async () => {
    calls++;
    return [88];
  });
  assert.deepEqual(await run(), { completed: 0, failed: 0 });
  assert.equal(calls, 0);
  assert.equal(context.classification.category, 'notification');
  assert.equal(context.classification.actions.length, 1);
  assert.equal(locked, 1);
} else if (mode === 'admission-scopes') {
  const contexts = Array.from({ length: 10 }, (_, index) => add(index + 1));
  contexts.forEach((context, index) => {
    context.thread.projectId = index + 1;
  });
  let release!: () => void;
  const intakeMayFinish = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  useReceiptIntake(async (input) => {
    calls++;
    if (first) {
      first = false;
      await intakeMayFinish;
    }
    return [input.messageId + 100];
  });
  const retry = (context: Context) =>
    retryReceiptFiling(1, { ...config, accountIds: [4] }, 'owner', context.thread.projectId!);
  const accepted = retry(contexts[0]!);
  const deferred = await Promise.all(contexts.slice(1).map(retry));
  assert.ok(deferred.every((result) => result.completed === 0 && result.failed === 0));
  release();
  assert.deepEqual(await accepted, { completed: 1, failed: 0 });
  assert.equal(calls, 1);
  for (const context of contexts.slice(1))
    assert.deepEqual(await retry(context), { completed: 1, failed: 0 });
  assert.equal(calls, 10);
} else if (mode === 'skipped-lock') {
  const context = add(1);
  useReceiptIntake(async () => {
    calls++;
    return [88];
  });
  skipRowLock = true;
  assert.deepEqual(await run(), { completed: 0, failed: 0 });
  assert.equal(calls, 0);
  assert.deepEqual(context.classification.actions, [empty]);
  skipRowLock = false;
  assert.deepEqual(await run(), { completed: 1, failed: 0 });
  assert.equal(calls, 1);
} else if (mode === 'admission-errors') {
  add(1);
  useReceiptIntake(async () => {
    throw new Error('synthetic intake failure');
  });
  assert.deepEqual(await run(), { completed: 0, failed: 1 });
  nextQueryError = true;
  await assert.rejects(run(), /synthetic DB failure/);
  useReceiptIntake(async () => {
    calls++;
    return [88];
  });
  assert.deepEqual(await run(), { completed: 1, failed: 0 });
  assert.equal(calls, 1);
} else if (mode === 'scope') {
  add(1).classification.category = 'notification';
  add(2).thread.projectId = 2;
  add(3).account.enabled = false;
  add(4).account.credentialId = null;
  add(5).message.deletedAt = new Date();
  add(6).classification.teamId = 2;
  add(7).classification.actions = [{ kind: 'receipt', receiptIds: [99] }];
  add(8).classification.actions = [{ kind: 'receipt' }];
  useReceiptIntake(async () => {
    calls++;
    return [88];
  });
  assert.deepEqual(await run(), { completed: 0, failed: 0 });
  assert.equal(calls, 0);
} else assert.fail('Unknown mode');
console.log(`retry:${mode}:ok`);
