/** Root stages this operator file; it imports only the reviewed live deployment. */
import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { userInfo } from 'node:os';

const root = '/srv/volition/source/plan';
let phase = 'preflight';
let assertions = 0;
const emit = (value: object) => process.stdout.write(`${JSON.stringify(value)}\n`);
const fail = () => {
  emit({ success: false, phase, assertions });
  process.exit(1);
};
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) console[level] = () => {};
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);
function check(ok: unknown, label: string): asserts ok {
  phase = label;
  if (!ok) throw new Error('Proof failed');
  assertions++;
}

try {
  const [mode, headArg, idArg, ...extra] = process.argv.slice(2);
  check(mode === 'cards' || mode === 'mail', 'mode');
  check(/^--expected-head=[a-f0-9]{40}$/.test(headArg ?? ''), 'expected-head-argument');
  check(/^--id=[1-9]\d*$/.test(idArg ?? '') && extra.length === 0, 'metadata-id-argument');
  const id = Number(idArg!.slice(5));
  check(Number.isSafeInteger(id) && id <= 2_147_483_647, 'metadata-id-range');
  check(userInfo().username === 'volition-plan', 'service-role');
  const staged = lstatSync(import.meta.path);
  check(staged.isFile() && staged.uid === 0 && (staged.mode & 0o022) === 0, 'root-staged-file');
  check(realpathSync(root) === root, 'canonical-source');
  const head = execFileSync(
    'git',
    ['-c', `safe.directory=${root}`, '-C', root, 'rev-parse', 'HEAD'],
    {
      encoding: 'utf8',
      stdio: 'pipe',
    },
  ).trim();
  check(head === headArg!.slice(16), 'exact-live-head');
  // Apply the read-only setting to every connection opened by this process.
  const url = new URL(process.env.DATABASE_URL ?? '');
  check(
    ['localhost', '127.0.0.1'].includes(url.hostname) && ['', '5432'].includes(url.port),
    'local-database',
  );
  url.searchParams.set('options', '-c default_transaction_read_only=on');
  process.env.DATABASE_URL = url.toString();
  const refuseNetwork = () => {
    throw new Error('No network');
  };
  globalThis.fetch = Object.assign(refuseNetwork, { preconnect: refuseNetwork });
  const load = createRequire(`${root}/apps/api/package.json`);
  const { db, issue, mailThread, project } = await import(`${root}/packages/db/src/index.ts`);
  const { eq, and, sql } = await import(load.resolve('drizzle-orm'));
  const [session] = await db.execute(
    sql`select current_setting('default_transaction_read_only') as readonly`,
  );
  check(session?.readonly === 'on', 'database-read-only');
  let projectId: number;
  if (mode === 'cards') {
    const [row] = await db
      .select({
        id: issue.id,
        projectId: issue.projectId,
        sequence: issue.sequenceNumber,
        key: project.key,
      })
      .from(issue)
      .innerJoin(project, eq(project.id, issue.projectId))
      .where(eq(issue.id, id));
    check(Boolean(row), 'existing-issue-metadata');
    projectId = row.projectId;
    const { approvalScope } = await import(`${root}/apps/api/src/modules/approvals/scope.ts`);
    const { levelRules } = await import(`${root}/apps/api/src/modules/autopilot/engine.ts`);
    const cases = [
      { action: `delete_issue {"issueId":${id}}`, expected: 'workspace' },
      { action: `Ticket ${row.key}-${row.sequence} endgültig löschen`, expected: 'workspace' },
      { action: `Delete the Drive folder for ${row.key}-${row.sequence}`, expected: 'external' },
      { action: `delete_issue {"issueId":${id}}`, scope: 'external', expected: 'external' },
    ];
    const rules = levelRules(3);
    for (const [index, entry] of cases.entries()) {
      const scope = await approvalScope({
        projectId,
        category: 'delete',
        action: entry.action,
        command: null,
        scope: entry.scope,
      });
      check(scope === entry.expected, `scope-case-${index}`);
      const rule = rules.find(
        (r: { category: string; scope: string }) => r.category === 'delete' && r.scope === scope,
      );
      check(
        rule?.reason === (scope === 'workspace' ? 'level-allows' : 'hard-block'),
        `policy-case-${index}`,
      );
    }
  } else {
    const [row] = await db
      .select({ id: mailThread.id, projectId: mailThread.projectId, key: mailThread.threadKey })
      .from(mailThread)
      .where(eq(mailThread.id, id));
    check(
      row?.projectId != null && row.key.startsWith('thread:') && row.key.length > 7,
      'existing-provider-thread-metadata',
    );
    projectId = row.projectId;
    const { resolveProjectThreadId } = await import(
      `${root}/apps/api/src/modules/mail/threads/resolve.ts`
    );
    check((await resolveProjectThreadId(String(id), projectId)) === id, 'numeric-local-id');
    check((await resolveProjectThreadId(row.key.slice(7), projectId)) === id, 'provider-id');
    check((await resolveProjectThreadId(row.key, projectId)) === id, 'stored-provider-key');
    const absent = '999999999999999999999999999999999999999999999';
    const collision = await db
      .select({ id: mailThread.id })
      .from(mailThread)
      .where(
        and(
          eq(mailThread.projectId, projectId),
          sql`${mailThread.threadKey} in (${absent}, ${`thread:${absent}`})`,
        ),
      )
      .limit(1);
    check(collision.length === 0, 'unknown-reference-precondition');
    let status: number | undefined;
    try {
      await resolveProjectThreadId(absent, projectId);
    } catch (error) {
      status = (error as { status?: number }).status;
    }
    check(status === 404, 'large-numeric-reference-404-not-500');
  }
  emit({
    success: true,
    readOnly: true,
    mode,
    head,
    id,
    projectId,
    assertions,
    provesHttpOrUi: false,
    createsDraft: false,
  });
  process.exit(0);
} catch {
  fail();
}
