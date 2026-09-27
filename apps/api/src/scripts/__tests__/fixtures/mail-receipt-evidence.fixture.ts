import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { factsFromText } from '../../../../../../packages/finance/src/receipt-text';
import { parseAmountCents } from '../../../../../../packages/finance/src/money';
import { receiptEvidenceCases } from './mail-receipt-evidence-cases';

globalThis.fetch = (() => assert.fail('Network requests forbidden')) as unknown as typeof fetch;

const mode = process.argv[2];
const sample = receiptEvidenceCases.find((entry) => entry.id === process.argv[3])!;
assert.ok(sample);
const raw = Buffer.from(`Subject: ${sample.subject}\r\n\r\n${sample.body}\r\n`);
const sentAt = new Date('2026-09-05');
const parsed = {
  subject: sample.subject,
  text: sample.body,
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
  sentAt,
  fromName: parsed.from.name,
  fromAddress: parsed.from.address,
};
const receipts: Record<string, unknown>[] = [];
const files = new Map<string, Buffer>();
const indexed: string[] = [];
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
};
const db = {
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
  transaction: async (body: (tx: { execute: () => Promise<void> }) => unknown) =>
    body({ execute: async () => {} }),
  insert: (value: { name: string }) => ({
    values: (row: Record<string, unknown>) => ({
      onConflictDoNothing: () => ({
        returning: async () => {
          assert.equal(value.name, 'receipt');
          const receipt = { ...row, id: 99, status: 'open' };
          receipts.push(receipt);
          return [{ id: receipt.id }];
        },
      }),
    }),
  }),
};
mock.module('@repo/db', () => ({ db, ...tables }));
mock.module('drizzle-orm', () =>
  Object.fromEntries(
    ['and', 'count', 'desc', 'eq', 'ilike', 'isNotNull', 'or', 'sql'].map((key) => [
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
  indexVaultPaths: async (paths: string[], provenance: { author: string }) => {
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
  ) => {
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
  matchReceipt: () => assert.fail('Matching must not run in this offline receipt check'),
  unlinkReceipt: () => assert.fail('Existing matches must remain untouched'),
});
moduleMock('receipts/views', {
  inMonth: () => true,
  receiptDetailView: () => ({}),
  receiptViews: () => [],
});
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
if (mode === 'history') {
  mock.module('@repo/mail', () => ({
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
}
console.log(`evidence:${mode}:${sample.id}:ok`);
