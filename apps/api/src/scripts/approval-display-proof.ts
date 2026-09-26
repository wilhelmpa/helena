/** Root stages this file separately; it imports the exact reviewed deployment. */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';

type Card = typeof import('@repo/db').approvalRequest.$inferSelect;
type Manifest = {
  version: 1;
  marker: string;
  head: string;
  database: string;
  role: string;
  projectId: number;
  agentId: number;
  issueId: number;
  cards: { id: number; sha256: string }[];
  state: 'prepared' | 'inserted' | 'retained' | 'archived' | 'cleaned';
  archiveSha256?: string;
};
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

let phase = 'preflight';
let assertions = 0;
const emit = (record: object) => process.stdout.write(`${JSON.stringify(record)}\n`);
function check(ok: unknown, label: string): asserts ok {
  phase = label;
  if (!ok) throw new Error('Display proof refused');
  assertions++;
}
const fail = () => {
  emit({ success: false, phase, assertions });
  process.exit(1);
};
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) console[level] = () => {};
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

try {
  const [mode, ...args] = process.argv.slice(2);
  check(['dry-run', 'apply', 'verify', 'cleanup'].includes(mode ?? ''), 'mode');
  const options = new Map<string, string>();
  for (const value of args) {
    const match =
      /^--(expected-head|database-name|database-role|run-id|manifest-dir|project-id|agent-id|issue-id|private-test-root)=(.+)$/.exec(
        value,
      );
    check(match && !options.has(match[1]!), 'unique-known-arguments');
    options.set(match[1]!, match[2]!);
  }
  const arg = (name: string) => options.get(name);
  const integer = (name: string) => {
    const value = arg(name) ?? '';
    check(/^[1-9]\d*$/.test(value) && Number(value) <= 2_147_483_647, 'metadata-id');
    return Number(value);
  };
  const projectId = integer('project-id');
  const agentId = integer('agent-id');
  const issueId = integer('issue-id');
  const runId = arg('run-id');
  check(/^[a-f0-9]{32}$/.test(runId ?? ''), 'explicit-run-id');
  const marker = `approval-display-${runId}`;
  const url = new URL(process.env.DATABASE_URL ?? '');
  const privateRoot = arg('private-test-root');
  const privateTest =
    process.env.NODE_ENV === 'test' &&
    url.hostname === '127.0.0.1' &&
    url.port === '65502' &&
    url.pathname === '/approval_display_test' &&
    privateRoot === '/home/wilhelmpa/agent-work/approval-display-acceptance';
  check(!privateRoot || privateTest, 'private-scope');
  const failurePoint = process.env.HELENA_DISPLAY_PROOF_FAILURE;
  check(
    !failurePoint ||
      (privateTest &&
        [
          'after-prepared-manifest',
          'after-insert-manifest',
          'after-insert-commit',
          'after-archive-write',
          'before-delete-commit',
          'after-delete-commit',
        ].includes(failurePoint)),
    'private-failure-injection',
  );
  const injectFailure = (point: string) => {
    if (failurePoint === point) check(false, `injected-${point}`);
  };
  const root = privateTest ? privateRoot! : '/srv/volition/source/plan';
  const uid = userInfo().uid;
  check(privateTest || userInfo().username === 'volition-plan', 'service-role');
  const staged = lstatSync(import.meta.path);
  check(
    staged.isFile() && (privateTest || (staged.uid === 0 && (staged.mode & 0o022) === 0)),
    'root-staged-file',
  );
  check(realpathSync(root) === root, 'canonical-source');
  const head = privateTest
    ? '0'.repeat(40)
    : execFileSync('git', ['-c', `safe.directory=${root}`, '-C', root, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
  check(/^[a-f0-9]{40}$/.test(head) && arg('expected-head') === head, 'exact-reviewed-head');
  check(
    privateTest ||
      (['localhost', '127.0.0.1'].includes(url.hostname) && ['', '5432'].includes(url.port)),
    'local-database',
  );
  // All imported service reads are read-only; only the two explicit transactions may write.
  url.searchParams.set('options', '-c default_transaction_read_only=on');
  process.env.DATABASE_URL = url.toString();
  const refuseNetwork = () => {
    throw new Error('Network disabled');
  };
  globalThis.fetch = Object.assign(refuseNetwork, { preconnect: refuseNetwork });
  const load = createRequire(join(root, 'apps/api/package.json'));
  const { db, approvalRequest, project, aiAgent, projectMember, issue } = (await import(
    join(root, 'packages/db/src/index.ts')
  )) as typeof import('@repo/db');
  const { and, eq, inArray, sql } = (await import(
    load.resolve('drizzle-orm')
  )) as typeof import('drizzle-orm');
  const [identity] = await db.execute<{ database: string; role: string; readonly: string }>(sql`
    select current_database() as database, current_user as role,
      current_setting('default_transaction_read_only') as readonly`);
  check(identity?.readonly === 'on', 'default-read-only');
  check(
    identity.database === arg('database-name') &&
      identity.role === arg('database-role') &&
      identity.database === decodeURIComponent(url.pathname.slice(1)),
    'reviewed-database-and-role',
  );
  const directory = arg('manifest-dir');
  check(directory && realpathSync(directory) === directory, 'canonical-manifest-directory');
  check(
    privateTest || directory === '/var/lib/volition/plan/proofs/approval-display',
    'manifest-location',
  );
  const dirStat = lstatSync(directory);
  check(
    dirStat.isDirectory() && dirStat.uid === uid && (dirStat.mode & 0o777) === 0o700,
    'private-directory',
  );
  for (let path = dirname(directory); path !== '/'; path = dirname(path)) {
    const stat = lstatSync(path);
    check(
      stat.isDirectory() &&
        (privateTest || ([0, uid].includes(stat.uid) && (stat.mode & 0o022) === 0)),
      'protected-parent',
    );
  }
  const manifestPath = join(directory, `${marker}.json`);
  const archivePath = join(directory, `${marker}.archive.json`);
  const readPrivate = (path: string) => {
    const stat = lstatSync(path);
    check(
      stat.isFile() && stat.nlink === 1 && stat.uid === uid && (stat.mode & 0o777) === 0o600,
      'private-regular-file',
    );
    return readFileSync(path, 'utf8');
  };
  const writeDurable = (path: string, content: string) => {
    const fd = openSync(path, 'wx', 0o600);
    try {
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const parent = openSync(directory, 'r');
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  };
  // A crash may leave the immutable archive before its digest reaches the manifest.
  // Adopt only the byte-identical, owner-private file; never replace an archive.
  const ensureArchive = (content: string) => {
    if (existsSync(archivePath)) check(readPrivate(archivePath) === content, 'unchanged-archive');
    else writeDurable(archivePath, content);
    return digest(content);
  };
  let manifest: Manifest = {
    version: 1,
    marker,
    head,
    database: identity.database,
    role: identity.role,
    projectId,
    agentId,
    issueId,
    cards: [],
    state: 'prepared',
  };
  let lastManifest: string | undefined;
  const save = () => {
    const content = `${JSON.stringify(manifest, null, 2)}\n`;
    if (lastManifest === undefined) writeDurable(manifestPath, content);
    else {
      check(readPrivate(manifestPath) === lastManifest, 'unchanged-manifest');
      const next = `${manifestPath}.${randomUUID()}.next`;
      writeDurable(next, content);
      renameSync(next, manifestPath);
      const parent = openSync(directory, 'r');
      try {
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
    }
    lastManifest = content;
  };
  if (mode === 'verify' || mode === 'cleanup') {
    lastManifest = readPrivate(manifestPath);
    const stored = JSON.parse(lastManifest) as Manifest;
    check(
      Object.entries(manifest)
        .filter(([key]) => !['cards', 'state'].includes(key))
        .every(([key, value]) => stored[key as keyof Manifest] === value),
      'exact-manifest-scope',
    );
    check(
      ['prepared', 'inserted', 'retained', 'archived', 'cleaned'].includes(stored.state) &&
        Array.isArray(stored.cards) &&
        (stored.cards.length === 0 || stored.cards.length === 2) &&
        stored.cards.every(
          (c) => Number.isSafeInteger(c.id) && c.id > 0 && /^[a-f0-9]{64}$/.test(c.sha256),
        ) &&
        new Set(stored.cards.map((c) => c.id)).size === stored.cards.length,
      'manifest-shape',
    );
    manifest = stored;
  }
  const ownWhere = sql`${approvalRequest.payload}->>'displayProof' = ${marker}`;
  const checkCards = (cards: Card[]) => {
    check(cards.length === 2 && manifest.cards.length === 2, 'exactly-two-cards');
    for (const card of cards)
      check(
        card.projectId === projectId &&
          card.agentId === agentId &&
          card.status === 'rejected' &&
          card.kind === 'delete' &&
          card.runId === null &&
          card.issueId === null &&
          card.command === null &&
          card.followUpRunId === null &&
          card.decidedByUserId === null &&
          card.decidedAt === null &&
          card.details.includes(marker) &&
          manifest.cards.some(
            (saved) => saved.id === card.id && saved.sha256 === digest(canonical(card)),
          ),
        'unchanged-owned-card',
      );
  };
  const assertNoReferences = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    ids: number[],
  ) => {
    const references = await tx.execute<{
      schema_name: string;
      table_name: string;
      column_name: string;
      keys: number;
      target: string;
    }>(sql`
      select ns.nspname as schema_name, cl.relname as table_name, a.attname as column_name,
        array_length(c.conkey,1) as keys, ra.attname as target
      from pg_constraint c join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
      join pg_attribute a on a.attrelid=cl.oid and a.attnum=c.conkey[1]
      join pg_attribute ra on ra.attrelid=c.confrelid and ra.attnum=c.confkey[1]
      where c.contype='f' and c.confrelid='public.approval_request'::regclass`);
    for (const ref of references) {
      check(ref.keys === 1 && ref.target === 'id', 'supported-reference-shape');
      const [count] = await tx.execute<{ count: number }>(sql`select count(*)::int as count
        from ${sql.identifier(ref.schema_name)}.${sql.identifier(ref.table_name)}
        where ${sql.identifier(ref.column_name)} in (${ids[0]}, ${ids[1]})`);
      check(count?.count === 0, 'no-dependent-rows');
    }
  };
  if (mode === 'cleanup') {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ WRITE`);
      await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
      const cards = await tx.select().from(approvalRequest).where(ownWhere).for('update');
      const ids = manifest.cards.map((c) => c.id);
      const byId = ids.length
        ? await tx
            .select({ id: approvalRequest.id })
            .from(approvalRequest)
            .where(inArray(approvalRequest.id, ids))
        : [];
      if (!cards.length && !byId.length) {
        check(
          ['prepared', 'inserted', 'archived', 'cleaned'].includes(manifest.state),
          'recoverable-absence',
        );
        if (manifest.state === 'inserted' && manifest.cards.length) {
          // The durable IDs are written before COMMIT. If the transaction rolled
          // back, retain that attempt's metadata so a second cleanup is provable.
          // "Absent" is an observation, not a claim about who removed a row.
          manifest.archiveSha256 = ensureArchive(
            `${canonical({
              version: 1,
              marker,
              head,
              cards: [],
              absentCards: manifest.cards,
            })}\n`,
          );
          manifest.state = 'archived';
          save();
        }
        if (['archived', 'cleaned'].includes(manifest.state) && manifest.cards.length)
          check(digest(readPrivate(archivePath)) === manifest.archiveSha256, 'durable-archive');
        return;
      }
      check(manifest.state !== 'cleaned', 'not-recreated');
      checkCards(cards);
      await assertNoReferences(tx, ids);
      const archive = `${canonical({ version: 1, marker, head, cards: cards.sort((a, b) => a.id - b.id) })}\n`;
      if (manifest.state === 'archived')
        check(digest(readPrivate(archivePath)) === manifest.archiveSha256, 'durable-archive');
      manifest.archiveSha256 = ensureArchive(archive);
      injectFailure('after-archive-write');
      manifest.state = 'archived';
      save();
      const deleted = await tx
        .delete(approvalRequest)
        .where(and(ownWhere, inArray(approvalRequest.id, ids)))
        .returning({ id: approvalRequest.id });
      check(deleted.length === 2, 'deleted-only-two-cards');
      injectFailure('before-delete-commit');
    });
    injectFailure('after-delete-commit');
    manifest.state = 'cleaned';
    save();
  } else {
    const [metadata] = await db
      .select({ projectId: project.id, key: project.key, agentId: aiAgent.id })
      .from(project)
      .innerJoin(aiAgent, and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, project.teamId)))
      .innerJoin(
        projectMember,
        and(eq(projectMember.projectId, project.id), eq(projectMember.userId, aiAgent.userId)),
      )
      .innerJoin(issue, and(eq(issue.id, issueId), eq(issue.projectId, project.id)))
      .where(eq(project.id, projectId));
    check(metadata, 'existing-project-agent-issue-scope');
    const { approvalScope } = (await import(
      join(root, 'apps/api/src/modules/approvals/scope.ts')
    )) as typeof import('../modules/approvals/scope');
    const { decide } = (await import(
      join(root, 'apps/api/src/modules/autopilot/engine.ts')
    )) as typeof import('../modules/autopilot/engine');
    const entries: (typeof approvalRequest.$inferInsert)[] = [];
    for (const [index, action] of [
      `delete_issue {"issueId":${issueId}}`,
      `Delete the fictional external object ${marker} at example.invalid`,
    ].entries()) {
      const scope = await approvalScope({ projectId, category: 'delete', action, command: null });
      const policy = await decide({
        adapter: 'approval',
        agentId,
        projectId,
        runId: null,
        category: 'delete',
        scope,
        tool: 'request_approval',
        summary: action,
        audit: false,
      });
      check(
        scope === (index === 0 ? 'workspace' : 'external') &&
          policy.level === 3 &&
          policy.reason === (index === 0 ? 'level-allows' : 'hard-block') &&
          policy.outcome === (index === 0 ? 'allow' : 'needs-approval') &&
          policy.decisionId === null,
        `derived-policy-${index}`,
      );
      entries.push({
        projectId,
        agentId,
        kind: 'delete',
        category: 'delete',
        action,
        details: `DISPLAY ONLY — SYNTHETIC (${marker}). No action was requested or executed.`,
        decisionNote:
          'DISPLAY ONLY — SYNTHETIC. Closed by the proof script; no person made a decision.',
        status: 'rejected',
        autopilotLevel: policy.level,
        policyReason: policy.reason,
        payload: { actionScope: scope, displayProof: marker },
      });
    }
    if (mode === 'apply') {
      const existing = await db
        .select({ id: approvalRequest.id })
        .from(approvalRequest)
        .where(ownWhere);
      check(existing.length === 0, 'unused-marker');
      save();
      injectFailure('after-prepared-manifest');
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION READ WRITE`);
        await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
        const cards = await tx.insert(approvalRequest).values(entries).returning();
        manifest.cards = cards.map((card) => ({ id: card.id, sha256: digest(canonical(card)) }));
        manifest.state = 'inserted';
        checkCards(cards);
        save(); // Durable IDs precede COMMIT, including recovery after an uncertain result.
        injectFailure('after-insert-manifest');
      });
      injectFailure('after-insert-commit');
      manifest.state = 'retained';
      save();
    }
    if (mode !== 'dry-run') {
      const cards = await db.select().from(approvalRequest).where(ownWhere);
      checkCards(cards);
      const { getApproval } = (await import(
        join(root, 'apps/api/src/modules/approvals/service.ts')
      )) as typeof import('../modules/approvals/service');
      for (const card of cards) {
        const dto = await getApproval(card.id);
        check(
          dto?.status === 'rejected' &&
            dto.scope === (card.payload as { actionScope: string }).actionScope &&
            dto.policyReason === card.policyReason &&
            dto.autopilotLevel === 3 &&
            dto.followUpRunId === null,
          'actual-service-dto',
        );
      }
      await db.transaction((tx) =>
        assertNoReferences(
          tx,
          manifest.cards.map((c) => c.id),
        ),
      );
    }
    emit({
      phase: 'display',
      scopes: ['workspace', 'external'],
      reasons: ['level-allows', 'hard-block'],
      uiPath: `/approvals?status=decided&project=${encodeURIComponent(metadata.key)}`,
    });
  }
  emit({
    success: true,
    mode,
    marker,
    head,
    projectId,
    agentId,
    issueId,
    ids: manifest.cards.map((c) => c.id),
    manifestPath,
    assertions,
    displayOnly: true,
    provesActionOrHttpAuthentication: false,
  });
  process.exit(0);
} catch {
  fail();
}
