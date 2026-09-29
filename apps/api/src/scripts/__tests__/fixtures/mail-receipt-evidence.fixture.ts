import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { factsFromText } from '../../../../../../packages/finance/src/receipt-text';
import { parseAmountCents } from '../../../../../../packages/finance/src/money';
import { receiptEvidenceCases } from './mail-receipt-evidence-cases';
import { parseMessage, receiptHtmlText } from '@repo/mail';
import { receiptMime } from '../../../modules/receipts/__tests__/fixtures/html-receipt';

globalThis.fetch = (() => assert.fail('Network requests forbidden')) as unknown as typeof fetch;

const mode = process.argv[2];
const sample = receiptEvidenceCases.find((entry) => entry.id === process.argv[3])!;
assert.ok(sample);
const raw = sample.html
  ? receiptMime(sample.body, sample.html)
  : Buffer.from(`Subject: ${sample.subject}\r\n\r\n${sample.body}\r\n`);
const sentAt = new Date('2026-09-05');
const parsed = sample.html
  ? await parseMessage(raw)
  : {
      subject: sample.subject,
      text: sample.body,
      html: null,
      date: sentAt,
      from: { name: 'Example Transit', address: 'billing@example.test' },
      attachments: [],
    };
mock.module('@helena/finance', () => ({ factsFromText, parseAmountCents }));
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const target = { id: 1, teamId: 1, key: 'BFR' };
const message = {
  id: 10,
  teamId: 1,
  accountId: 4,
  threadId: 20,
  size: raw.length,
  rawKey: 'fixture',
  subject: sample.subject,
  textBody: sample.body,
  htmlBody: parsed.html,
  sentAt,
  fromName: parsed.from!.name,
  fromAddress: parsed.from!.address,
};
const receipts: Record<string, unknown>[] = [];
const files = new Map<string, Buffer>();
const indexed: string[] = [];
const matched: number[] = [];
let failInsert = false;
let failIndex = false;
let failWrite = false;
let failMatch = false;
const transactionContext = new AsyncLocalStorage<boolean>();
let transactionTail = Promise.resolve();
const table = (name: string) => ({ name, id: `${name}.id` });
const tables = {
  project: table('project'),
  mailMessage: table('message'),
  mailThread: table('thread'),
  mailAttachment: table('attachment'),
  helenaReceipt: table('receipt'),
  helenaBankAccount: table('account'),
  helenaBankTransaction: table('transaction'),
  helenaReceiptMatch: table('match'),
  helenaReceiptOriginalLink: table('originalLink'),
  helenaReceiptPairHistory: table('pairHistory'),
  helenaReceiptPairSuggestion: table('pairSuggestion'),
};
const executor = {
  select: (fields?: Record<string, unknown>) => {
    let selected: { name: string };
    const query = {
      from: (value: { name: string }) => {
        selected = value;
        return query;
      },
      innerJoin: () => query,
      where: async () => {
        if (selected.name === 'project') return [target];
        if (selected.name === 'receipt') return receipts;
        if (selected.name !== 'message') return [];
        if (fields && 'message' in fields) return [{ message, projectId: target.id }];
        return [{ ...message, projectId: target.id, projectKey: target.key }];
      },
    };
    return query;
  },
  insert: (value: { name: string }) => ({
    values: (row: Record<string, unknown>) => ({
      onConflictDoNothing: () => ({
        returning: async () => {
          assert.equal(value.name, 'receipt');
          const receipt = { ...row, id: 99, status: 'open' };
          receipts.push(receipt);
          if (failInsert) throw new Error('Synthetic late SQL failure');
          return [{ id: receipt.id }];
        },
      }),
    }),
  }),
};
const db = {
  select: (...args: Parameters<typeof executor.select>) => {
    assert.notEqual(
      transactionContext.getStore(),
      true,
      'Global DB read inside intake transaction',
    );
    return executor.select(...args);
  },
  insert: (...args: Parameters<typeof executor.insert>) => {
    assert.notEqual(
      transactionContext.getStore(),
      true,
      'Global DB write inside intake transaction',
    );
    return executor.insert(...args);
  },
  transaction: async (body: (tx: unknown) => unknown): Promise<unknown> => {
    const prior = transactionTail;
    let release!: () => void;
    transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    const snapshot = structuredClone(receipts);
    try {
      return await transactionContext.run(true, () =>
        body({ ...executor, execute: async () => {} }),
      );
    } catch (error) {
      receipts.splice(0, receipts.length, ...snapshot);
      throw error;
    } finally {
      release();
    }
  },
};
mock.module('@repo/db', () => ({ db, getSetting: async () => null, ...tables }));
mock.module('drizzle-orm', () =>
  Object.fromEntries(
    ['and', 'count', 'desc', 'eq', 'ilike', 'inArray', 'isNotNull', 'or', 'sql'].map((key) => [
      key,
      () => null,
    ]),
  ),
);
mock.module('@repo/storage', () => ({
  getObject: async () => ({ body: new Response(raw).body! }),
}));
mock.module('@repo/vault', () => ({
  absoluteVaultPath: (value: string) => value,
  indexVaultPaths: async (
    paths: string[],
    provenance: { author: string },
    options: { throwOnError: boolean },
  ) => {
    assert.notEqual(transactionContext.getStore(), true, 'Indexing before intake commit');
    assert.deepEqual(options, { throwOnError: true });
    if (failIndex) throw new Error('Synthetic index failure');
    assert.deepEqual(paths, [...files.keys()]);
    assert.equal(provenance.author, 'mail-receipts');
    indexed.push(...paths);
  },
}));
const moduleMock = (relative: string, exports: Record<string, unknown>) =>
  mock.module(new URL(`../../../modules/${relative}.ts`, import.meta.url).pathname, () => exports);
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
mock.module(new URL('../../../shared/lib.ts', import.meta.url).pathname, () => ({ HttpError }));
moduleMock('project-files/paths', {
  joinPath: (...parts: string[]) => parts.join('/'),
  relativePath: (value: string) => value,
  safeFileName: (value: string) => value,
});
moduleMock('project-files/roots', {
  projectRoot: () => ({ vaultPath: 'Projects/BFR' }),
  projectVaultPath: () => 'Projects/BFR',
});
moduleMock('project-files/serve', { contentTypeOf: () => 'message/rfc822' });
moduleMock('project-files/service', {
  describeVaultFile: async (root: { vaultPath: string }, relative: string) => {
    const key = `${root.vaultPath}/${relative}`;
    const bytes = files.get(key);
    if (!bytes) throw new HttpError(404, 'File not found');
    return { vaultPath: key, sha256: hash(bytes), sizeBytes: bytes.length };
  },
  writeUniqueFile: async (
    root: { vaultPath: string },
    folder: string,
    filename: string,
    bytes: Buffer,
    _actor: unknown,
    options: { deferIndex?: boolean },
  ) => {
    assert.deepEqual(options, { deferIndex: true }, 'Intake must defer writer indexing');
    if (failWrite) throw new Error('Synthetic original write failure');
    assert.equal(
      files.has(`${root.vaultPath}/${folder}/${filename}`),
      false,
      'Must reuse canonical original',
    );
    files.set(`${root.vaultPath}/${folder}/${filename}`, bytes);
    return `${folder}/${filename}`;
  },
});
moduleMock('receipts/amounts', {
  centsToNumeric: (value: number) => String(value / 100),
  monthRange: () => ({}),
});
moduleMock('receipts/extract', {
  extractReceiptFile: () => assert.fail('Unexpected attachment extraction'),
  isReceiptFile: () => true,
});
moduleMock('receipts/matching', {
  matchReceipt: async (id: number) => {
    assert.ok(mode.startsWith('intake-'), 'Unexpected matching in evidence check');
    assert.notEqual(transactionContext.getStore(), true, 'Matching before intake commit');
    assert.ok(
      receipts.some((receipt) => receipt.id === id),
      'Matching needs a committed receipt',
    );
    matched.push(id);
    if (failMatch) throw new Error('Synthetic matching failure');
  },
  unlinkReceipt: () => assert.fail('Existing matches must remain untouched'),
});
moduleMock('receipts/views', {
  inMonth: () => true,
  receiptDetailView: () => ({}),
  receiptViews: () => [],
});
// Pair and duplicate detection has its own tests (receipts/__tests__/integration/dedup.test.ts);
// here it only has to run inside the intake transaction, on the receipts it just stored.
moduleMock('receipts/dedup', {
  autoMergeEnabled: async () => {
    assert.notEqual(transactionContext.getStore(), true, 'Setting read inside intake transaction');
    return true;
  },
  inspectNewReceipts: async (_tx: unknown, projectId: number, newIds: number[]) => {
    assert.equal(transactionContext.getStore(), true, 'Pair detection outside intake transaction');
    assert.equal(projectId, target.id);
    for (const id of newIds) assert.ok(receipts.some((receipt) => receipt.id === id));
    return [];
  },
});
// The second-brain projection rebuild after an intake has its own integration test.
moduleMock('receipts/projection', { rebuildReceiptProjection: async () => {} });
moduleMock('receipts/source', {
  receiptSourceLinks: () => assert.fail('Source links must not be rendered during intake'),
});

const { intakeMailReceipts } = await import('../../../modules/receipts/receipts');
const { mailReceiptFacts, hasMailReceiptEvidence } =
  await import('../../../modules/receipts/mail-facts');
const facts = mailReceiptFacts(message);
assert.equal(hasMailReceiptEvidence(sample.subject, facts), sample.selected);
const input = {
  teamId: 1,
  projectId: 1,
  messageId: 10,
  actorUserId: null,
  skipMatching: true,
};
if (mode.startsWith('intake-')) {
  const matchingInput = { ...input, skipMatching: false };
  if (mode === 'intake-parallel') {
    const all = await Promise.all(
      Array.from({ length: 10 }, () => intakeMailReceipts(matchingInput)),
    );
    assert.ok(all.every((ids) => ids.length === 1 && ids[0] === 99));
    assert.equal(receipts.length, 1);
    assert.deepEqual(matched, [99]);
    await intakeMailReceipts(matchingInput);
    assert.deepEqual(matched, [99]);
  } else if (mode === 'intake-sql-rollback') {
    failInsert = true;
    await assert.rejects(intakeMailReceipts(matchingInput), /Synthetic late SQL failure/);
    assert.equal(receipts.length, 0);
    assert.equal(files.size, 1);
    assert.equal(indexed.length, 0);
    assert.equal(matched.length, 0);
    failInsert = false;
    const [canonical, original] = [...files.entries()][0]!;
    files.set(canonical, Buffer.from('altered original'));
    await assert.rejects(intakeMailReceipts(matchingInput), /archived original changed/);
    assert.equal(receipts.length, 0);
    files.set(canonical, original);
    assert.deepEqual(await intakeMailReceipts(matchingInput), [99]);
    assert.equal(files.size, 1);
    assert.deepEqual(matched, [99]);
  } else if (mode === 'intake-index-retry' || mode === 'intake-index-and-match-error') {
    failIndex = true;
    failMatch = mode === 'intake-index-and-match-error';
    const errorLog = console.error;
    let matchingErrors = 0;
    try {
      console.error = () => {
        matchingErrors++;
      };
      await assert.rejects(intakeMailReceipts(matchingInput), /Synthetic index failure/);
    } finally {
      console.error = errorLog;
    }
    assert.equal(matchingErrors, failMatch ? 1 : 0);
    assert.equal(receipts.length, 1);
    assert.equal(indexed.length, 0);
    assert.deepEqual(matched, [99]);
    failIndex = false;
    assert.deepEqual(await intakeMailReceipts(matchingInput), [99]);
    assert.equal(indexed.length, 1);
    assert.deepEqual(matched, [99]);
  } else if (mode === 'intake-fs-error') {
    failWrite = true;
    await assert.rejects(intakeMailReceipts(matchingInput), /Synthetic original write failure/);
    assert.equal(receipts.length, 0);
    assert.equal(files.size, 0);
    assert.equal(matched.length, 0);
    failWrite = false;
    assert.deepEqual(await intakeMailReceipts(input), [99]);
    assert.equal(matched.length, 0);
  } else assert.fail('Unknown intake mode');
} else if (mode === 'history') {
  mock.module('@repo/mail', () => ({
    receiptHtmlText,
    sha256: hash,
    parseMessage: async (bytes: Buffer) => {
      assert.deepEqual(bytes, raw);
      return parsed;
    },
  }));
  const worker = new URL('../../../../../worker/src/mail/', import.meta.url);
  mock.module(new URL('import.ts', worker).pathname, () => ({
    importRawMessage: async (
      account: { triageEnabled: boolean },
      bytes: Buffer,
      location: { newInboxMail: boolean; folderId: null },
    ) => {
      assert.equal(account.triageEnabled, false);
      assert.equal(location.newInboxMail, false);
      assert.equal(location.folderId, null);
      assert.deepEqual(bytes, raw);
      return 10;
    },
  }));
  mock.module(new URL('store.ts', worker).pathname, () => ({
    flagsOf: () => ({}),
    connectSettings: () => ({}),
    loadSyncAccounts: () => [],
  }));
  mock.module(new URL('transport.ts', worker).pathname, () => ({
    mailTransport: () => assert.fail('Provider connection forbidden'),
  }));
  const { inspectReceiptHistory, applyReceiptHistory } = await import('../../mail-receipt-history');
  const client = {
    mailbox: { path: 'Archive', uidValidity: 1n },
    getMailboxLock: async (_folder: string, options: { readOnly: boolean }) => {
      assert.equal(options.readOnly, true);
      return { release() {} };
    },
    search: async (criteria: { since?: Date; or: { subject?: string }[] }) => {
      if (sample.id === 'french-only')
        assert.ok(criteria.or.some((term) => term.subject === 'justificatif'));
      return criteria.since ? [1] : [];
    },
    fetchAll: async () => [
      { uid: 1, size: raw.length, source: raw, flags: new Set(), internalDate: sentAt },
    ],
  };
  const account = { id: 4, projectId: 1, teamId: 1 };
  const manifest = await inspectReceiptHistory(client as never, account as never, {
    projectKey: 'BFR',
    folder: 'Archive',
    since: '2026-01-01',
    before: '2026-09-26',
    limit: 1,
  });
  assert.equal(manifest.candidates.length, 1);
  assert.equal(manifest.candidates[0]!.selected, sample.selected);
  assert.equal(manifest.candidates[0]!.includeBody, sample.selected);
  const result = await applyReceiptHistory(client as never, account as never, manifest);
  assert.equal(result.reports.length, sample.selected ? 1 : 0);
  assert.deepEqual(await applyReceiptHistory(client as never, account as never, manifest), result);
} else {
  const ids = await intakeMailReceipts(input);
  assert.deepEqual(ids, sample.selected ? [99] : []);
  assert.deepEqual(await intakeMailReceipts(input), ids);
}
assert.equal(receipts.length, sample.selected ? 1 : 0);
assert.equal(files.size, sample.selected ? 1 : 0);
if (sample.selected) {
  assert.equal(receipts[0]!.totalGross, String(sample.gross / 100));
  assert.equal(receipts[0]!.vatAmount, sample.vat === null ? null : String(sample.vat / 100));
  assert.equal(receipts[0]!.currency, sample.currency ?? 'EUR');
  assert.equal(receipts[0]!.status, 'open');
  assert.deepEqual([...files.values()][0], raw);
  assert.ok(indexed.length > 0);
  if (sample.html) {
    assert.equal(receipts[0]!.invoiceNumber, 'FICTION-92001');
    const details = receipts[0]!.details as Record<string, unknown>;
    assert.deepEqual(details.mailBody, { part: 'text/html-fallback', fallback: 'accepted' });
    const { backfillMailReceipts } = await import('../../mail-receipt-backfill');
    const dry = await backfillMailReceipts([
      { messageId: 10, accountId: 4, projectKey: 'BFR', attachmentIds: [], includeBody: true },
    ]);
    assert.equal(dry.missingFacts, 0);
    assert.deepEqual(dry.reports[0]!.files[0]!.bodyProvenance, details.mailBody);
    assert.equal(dry.reports[0]!.files[0]!.sha256, hash(raw));
  }
}
console.log(`evidence:${mode}:${sample.id}:ok`);
