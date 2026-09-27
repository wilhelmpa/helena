import { constants } from 'node:fs';
import { lstat, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '@repo/db';
import { sql } from 'drizzle-orm';
import { extractReceiptFile } from '#modules/receipts/extract';
import { centsToNumeric, numericToCents } from '#modules/receipts/amounts';
import { assertNoSymlinks, relativePath, resolveInside } from '#modules/project-files/paths';
import { projectRoot } from '#modules/project-files/roots';
import {
  canonical,
  checkBinding,
  checkFacts,
  digest,
  parseManifest,
  requireCorrection,
  type Binding,
  type Correction,
  type Facts,
} from './receipt-correction/review';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Row = Record<string, unknown>;
type Review = {
  version: 1;
  mode: 'dry-run';
  release: string;
  manifestSha256: string;
  entries: Binding[];
};

async function releaseGuard(release: string) {
  requireCorrection(ROOT === '/srv/volition/source/plan/');
  requireCorrection(
    (await readFile('/var/lib/volition/deploy/deployed', 'utf8')).trim() === release,
  );
  const head = Bun.spawnSync(['git', '-C', ROOT, 'rev-parse', 'HEAD']);
  requireCorrection(head.exitCode === 0 && head.stdout.toString().trim() === release);
  requireCorrection(
    Bun.spawnSync([
      'git',
      '-C',
      ROOT,
      'merge-base',
      '--is-ancestor',
      'f1efcac021f39a5b78fdcbbfa497dee2e6ffbfff',
      release,
    ]).exitCode === 0,
  );
  requireCorrection(
    Bun.spawnSync(['git', '-C', ROOT, 'diff', '--quiet', 'HEAD', '--', 'apps/api/src', 'packages'])
      .exitCode === 0,
  );
}

async function privateInput(filename: string): Promise<unknown> {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    requireCorrection(
      info.isFile() &&
        info.nlink === 1 &&
        (info.mode & 0o777) === 0o600 &&
        info.size <= 1024 * 1024 &&
        (info.uid === 0 || info.uid === process.getuid?.()),
    );
    return JSON.parse(await file.readFile('utf8'));
  } finally {
    await file.close();
  }
}

async function original(entry: Correction, row: Row): Promise<Buffer> {
  const root = projectRoot(entry.projectKey);
  const prefix = `Projects/${entry.projectKey}/`;
  requireCorrection(
    typeof row.vault_path === 'string' && row.vault_path.startsWith(`${prefix}Files/`),
  );
  const target = resolveInside(root.directory, relativePath(row.vault_path.slice(prefix.length)));
  await assertNoSymlinks('/', target.slice(1));
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    requireCorrection(
      info.isFile() && info.size === entry.originalSize && info.size <= 25 * 1024 * 1024,
    );
    const data = await file.readFile();
    requireCorrection(
      data.length === entry.originalSize &&
        createHash('sha256').update(data).digest('hex') === entry.originalSha256,
    );
    return data;
  } finally {
    await file.close();
  }
}

async function prepare(tx: Tx, entry: Correction, apply: boolean): Promise<Binding> {
  const rows = await tx.execute(sql`
    SELECT to_jsonb(r) AS receipt, r.xmin::text AS revision, p.key AS project_key, p.team_id AS project_team_id
    FROM helena_receipt r JOIN project p ON p.id = r.project_id
    WHERE r.id = ${entry.receiptId}
    ${apply ? sql`FOR UPDATE OF r` : sql``}`);
  requireCorrection(rows.length === 1);
  const row = rows[0]!.receipt as Row;
  requireCorrection(
    rows[0]!.project_key === entry.projectKey &&
      rows[0]!.project_team_id === entry.teamId &&
      row.project_id === entry.projectId &&
      row.team_id === entry.teamId,
  );
  requireCorrection(row.source === 'mail' && row.status === 'open' && row.extraction === 'text');
  requireCorrection(
    row.sha256 === entry.originalSha256 &&
      Number(row.size) === entry.originalSize &&
      row.mail_attachment_id === entry.attachmentId,
  );
  const details = row.details as {
    mailSource?: { messageId?: number; threadId?: number; kind?: string };
  };
  requireCorrection(
    details?.mailSource?.messageId === entry.messageId &&
      details.mailSource.threadId === entry.threadId &&
      details.mailSource.kind === (entry.attachmentId === null ? 'body' : 'attachment'),
  );
  const sources = await tx.execute(sql`
    SELECT to_jsonb(m) AS message, to_jsonb(t) AS thread
    FROM mail_message m JOIN mail_thread t ON t.id = m.thread_id
    WHERE m.id = ${entry.messageId} AND t.id = ${entry.threadId}
      AND m.team_id = ${entry.teamId} AND t.project_id = ${entry.projectId}
      AND t.team_id = ${entry.teamId} AND t.account_id = m.account_id
      AND m.account_id = ${entry.projectKey === 'FAM' ? 5 : 4}
    ${apply ? sql`FOR SHARE OF m, t` : sql``}`);
  requireCorrection(sources.length === 1);
  let attachment: unknown = null;
  if (entry.attachmentId !== null) {
    const attached = await tx.execute(sql`
      SELECT to_jsonb(a) AS attachment FROM mail_attachment a
      WHERE a.id = ${entry.attachmentId} AND a.message_id = ${entry.messageId}
        AND a.sha256 = ${entry.originalSha256} AND a.size = ${entry.originalSize}
      ${apply ? sql`FOR SHARE OF a` : sql``}`);
    requireCorrection(attached.length === 1);
    attachment = attached[0]!.attachment;
  }
  const matches = await tx.execute(
    sql`SELECT id FROM helena_receipt_match WHERE receipt_id = ${entry.receiptId}`,
  );
  requireCorrection(matches.length === 0);
  requireCorrection(typeof row.filename === 'string');
  const extension = path.extname(row.filename).toLowerCase();
  requireCorrection(extension === (entry.projectKey === 'FAM' ? '.pdf' : '.eml'));
  const data = await original(entry, row);
  const directory = await mkdtemp(path.join(tmpdir(), 'helena-receipt-correction-'));
  let extracted: Facts;
  try {
    const target = path.join(directory, `original${extension}`);
    await writeFile(target, data, { mode: 0o600, flag: 'wx' });
    // Only these four fields are considered; direction and all matching data remain untouched.
    const parsed = await extractReceiptFile(target, row.filename, []);
    requireCorrection(parsed.extraction === 'text' && parsed.extractionError === null);
    extracted = {
      issuer: parsed.issuer,
      totalGrossCents: parsed.grossCents,
      vatCents: parsed.vatCents,
      currency: parsed.currency ?? 'EUR',
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  checkFacts(
    entry,
    {
      issuer: row.issuer as string | null,
      totalGrossCents: numericToCents(row.total_gross as string | null),
      vatCents: numericToCents(row.vat_amount as string | null),
      currency: row.currency as string,
    },
    extracted,
  );
  await original(entry, row);
  return {
    receiptId: entry.receiptId,
    revision: String(rows[0]!.revision),
    rowSha256: digest(row),
    sourceSha256: digest({ ...sources[0], attachment }),
    originalSha256: entry.originalSha256,
    originalSize: entry.originalSize,
    changes: entry.changes,
  };
}

export async function correctReviewedReceipts(
  input: unknown,
  reviewed?: unknown,
): Promise<Review | { mode: 'apply'; receiptIds: number[] }> {
  const manifest = parseManifest(input);
  await releaseGuard(manifest.release);
  const expected = reviewed as Review | undefined;
  if (reviewed !== undefined) requireCorrection(expected && typeof expected === 'object');
  if (expected)
    requireCorrection(
      expected.version === 1 &&
        expected.mode === 'dry-run' &&
        expected.release === manifest.release &&
        expected.manifestSha256 === digest(manifest) &&
        Array.isArray(expected.entries) &&
        expected.entries.length === 9,
    );
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
    if (!expected) await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const entries: Binding[] = [];
    for (const entry of [...manifest.corrections].sort((a, b) => a.receiptId - b.receiptId)) {
      const current = await prepare(tx, entry, !!expected);
      if (expected) {
        const matches = expected.entries.filter((item) => item.receiptId === entry.receiptId);
        requireCorrection(matches.length === 1);
        checkBinding(matches[0]!, current);
      }
      entries.push(current);
    }
    await releaseGuard(manifest.release);
    if (!expected)
      return {
        version: 1,
        mode: 'dry-run',
        release: manifest.release,
        manifestSha256: digest(manifest),
        entries,
      };
    for (const entry of manifest.corrections) {
      const changes = entry.changes;
      const assignments = [];
      if (changes.issuer !== undefined) assignments.push(sql`issuer = ${changes.issuer}`);
      if (changes.totalGrossCents !== undefined)
        assignments.push(sql`total_gross = ${centsToNumeric(changes.totalGrossCents!)}`);
      if (changes.vatCents !== undefined)
        assignments.push(sql`vat_amount = ${centsToNumeric(changes.vatCents!)}`);
      if (changes.currency !== undefined) assignments.push(sql`currency = ${changes.currency}`);
      const result = await tx.execute(
        sql`UPDATE helena_receipt SET ${sql.join(assignments, sql`, `)} WHERE id = ${entry.receiptId} RETURNING id`,
      );
      requireCorrection(result.length === 1);
    }
    return { mode: 'apply', receiptIds: entries.map((entry) => entry.receiptId) };
  });
}

async function main() {
  const args = process.argv.slice(2);
  requireCorrection(args.every((arg) => /^(--manifest=|--output=|--reviewed=|--apply$)/.test(arg)));
  const option = (name: string) => {
    const values = args.filter((arg) => arg.startsWith(`--${name}=`));
    requireCorrection(values.length <= 1);
    return values[0]?.slice(name.length + 3);
  };
  const manifest = option('manifest');
  const output = option('output');
  const reviewed = option('reviewed');
  requireCorrection(manifest && output && args.filter((arg) => arg === '--apply').length <= 1);
  requireCorrection(args.includes('--apply') === !!reviewed);
  const manifestValue = await privateInput(manifest);
  const reviewedValue = reviewed ? await privateInput(reviewed) : undefined;
  const parent = await lstat(path.dirname(path.resolve(output)));
  requireCorrection(
    parent.isDirectory() && !parent.isSymbolicLink() && (parent.mode & 0o777) === 0o700,
  );
  const handle = await open(
    output,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(
      JSON.stringify({
        state: 'intent',
        mode: reviewed ? 'apply' : 'dry-run',
        manifestSha256: digest(manifestValue),
        reviewedSha256: reviewed ? digest(reviewedValue) : null,
      }) + '\n',
    );
    await handle.sync();
    const parentHandle = await open(
      path.dirname(path.resolve(output)),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await parentHandle.sync();
    } finally {
      await parentHandle.close();
    }
    const result = await correctReviewedReceipts(manifestValue, reviewedValue);
    await handle.truncate(0);
    await handle.write(canonical(result) + '\n', 0);
    await handle.sync();
    console.log(JSON.stringify({ completed: true, mode: result.mode, receipts: 9 }));
  } finally {
    await handle.close();
  }
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch(() => {
      console.error(
        JSON.stringify({
          completed: false,
          error: 'receipt-correction-stopped',
          evidenceRetained: true,
        }),
      );
      process.exit(1);
    });
}
