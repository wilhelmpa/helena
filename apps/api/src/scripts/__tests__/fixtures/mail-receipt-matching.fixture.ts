import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

globalThis.fetch = (() => assert.fail('Network requests forbidden')) as unknown as typeof fetch;

const mode = process.argv[2];
const raw = Buffer.from('Subject: Payment receipt\r\n\r\nAmount paid: 12.00 EUR\r\n');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const target = { id: 1, teamId: 1, key: 'BFR' };
const message = {
  id: 10,
  teamId: 1,
  accountId: 4,
  threadId: 20,
  size: raw.length,
  rawKey: 'fixture',
};
const receipts: Record<string, unknown>[] = [];
const matches: number[] = [];
const files = new Map<string, Buffer>();
const indexed: string[] = [];
let matchingCalls = 0;
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
  transaction: async (body: (tx: unknown) => unknown): Promise<unknown> =>
    body({ ...db, execute: async () => {} }),
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
mock.module('@repo/db', () => ({ db, ...tables, getSetting: async () => null }));
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
moduleMock('receipts/mail-facts', {
  mailReceiptFacts: () => ({
    grossCents: 1200,
    vatCents: null,
    invoiceDate: '2026-09-05',
    details: {},
  }),
  hasMailReceiptEvidence: () => true,
  receiptFilename: () => false,
  unrelatedFilename: () => false,
});
moduleMock('receipts/matching', {
  matchReceipt: async (id: number) => {
    matchingCalls++;
    matches.push(id);
    receipts[0]!.status = 'matched';
  },
  unlinkReceipt: () => assert.fail('Existing matches must remain untouched'),
});
moduleMock('receipts/views', {
  inMonth: () => true,
  receiptDetailView: () => ({}),
  receiptViews: () => [],
});
// Pair and duplicate detection has its own tests (receipts/__tests__/integration/dedup.test.ts);
// this fixture checks only which receipts intake hands on to matching.
moduleMock('receipts/dedup', {
  autoMergeEnabled: async () => true,
  inspectNewReceipts: async () => [],
});
// "Belege als Notizen" is off here; its own tests cover the projection.
moduleMock('receipts/projection', {
  rebuildReceiptProjection: async () => ({
    enabled: false,
    projected: 0,
    changed: 0,
    basePath: '',
  }),
});
moduleMock('receipts/source', {
  receiptSourceLinks: () => assert.fail('Source links must not be rendered during intake'),
});

const { intakeMailReceipts } = await import('../../../modules/receipts/receipts');
const input = {
  teamId: 1,
  projectId: 1,
  messageId: 10,
  actorUserId: null,
  attachmentIds: [],
  includeBody: true,
};
if (mode === 'backfill') {
  const { backfillMailReceipts } = await import('../../mail-receipt-backfill');
  const manifest = [
    { messageId: 10, accountId: 4, projectKey: 'BFR', attachmentIds: [], includeBody: true },
  ];
  const review = await backfillMailReceipts(manifest);
  await backfillMailReceipts(manifest, true, review);
} else if (mode === 'history') {
  mock.module('@repo/mail', () => ({
    sha256: hash,
    parseMessage: async () => ({ attachments: [] }),
  }));
  const worker = new URL('../../../../../worker/src/mail/', import.meta.url);
  mock.module(new URL('import.ts', worker).pathname, () => ({ importRawMessage: async () => 10 }));
  mock.module(new URL('store.ts', worker).pathname, () => ({
    flagsOf: () => ({}),
    connectSettings: () => ({}),
    loadSyncAccounts: () => [],
  }));
  mock.module(new URL('transport.ts', worker).pathname, () => ({
    mailTransport: () => assert.fail('Provider connection forbidden'),
  }));
  const { applyReceiptHistory } = await import('../../mail-receipt-history');
  const client = {
    mailbox: { path: 'Archive', uidValidity: 1n },
    getMailboxLock: async () => ({ release() {} }),
    fetchAll: async () => [
      {
        uid: 1,
        size: raw.length,
        source: raw,
        flags: new Set(),
        internalDate: new Date('2026-09-05'),
      },
    ],
  };
  await applyReceiptHistory(client as never, { id: 4, projectId: 1, teamId: 1 } as never, {
    accountId: 4,
    projectKey: 'BFR',
    folder: 'Archive',
    uidValidity: '1',
    since: '2026-01-01',
    before: '2026-09-26',
    nextBeforeUid: null,
    remaining: 0,
    earlierCandidates: 0,
    oversizedUids: [],
    candidates: [
      {
        uid: 1,
        sha256: hash(raw),
        subject: 'Payment receipt',
        attachmentSha256: [],
        attachments: [],
        includeBody: true,
        selected: true,
      },
    ],
  });
} else {
  const ids = await intakeMailReceipts({
    ...input,
    ...(mode === 'default' ? {} : { skipMatching: mode !== 'false' && mode !== 'existing' }),
  });
  assert.deepEqual(ids, [99]);
  if (mode === 'existing') {
    assert.equal(matchingCalls, 1);
    const prior = JSON.stringify({ receipts, matches });
    assert.deepEqual(await intakeMailReceipts({ ...input, skipMatching: true }), ids);
    assert.equal(JSON.stringify({ receipts, matches }), prior);
  }
}
const expectedCalls = ['default', 'false', 'existing'].includes(mode!) ? 1 : 0;
assert.equal(matchingCalls, expectedCalls);
assert.equal(receipts.length, 1);
assert.equal(receipts[0]!.status, expectedCalls ? 'matched' : 'open');
assert.equal(files.size, 1);
assert.deepEqual([...new Set(indexed)], [...files.keys()]);
assert.equal(indexed.length, mode === 'existing' ? 2 : 1);
assert.deepEqual([...files.values()][0], raw);
console.log(`matching:${mode}:ok`);
