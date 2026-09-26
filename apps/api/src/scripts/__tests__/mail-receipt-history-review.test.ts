import { beforeEach, expect, it } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  db,
  helenaReceipt,
  hubInboxEvent,
  mailMessage,
  mailMessageFolder,
  mailThread,
} from '@repo/db';
import { sha256 } from '@repo/mail';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { insertMailAccount } from '#tests/helpers/mail';
import {
  eml,
  FakeImapClient,
  FakeImapServer,
} from '../../../../worker/src/__tests__/helpers/fake-mail';
import { loadSyncAccounts } from '../../../../worker/src/mail/store';
import type { ImapClient } from '../../../../worker/src/mail/transport';
import { inspectReceiptHistory, MAX_BATCH_BYTES } from '../mail-receipt-history';
import { exportReceiptHistoryReview } from '../mail-receipt-history-review';

beforeEach(resetDb);

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'REVIEW', name: 'Private review' })).data!;
  const { accountId } = await insertMailAccount(project.teamId, project.id);
  const [account] = await loadSyncAccounts(accountId);
  const server = new FakeImapServer();
  const box = server.addMailbox('INBOX');
  const raw = Buffer.from(
    eml({
      id: '<invoice@fixture.example>',
      subject: 'Invoice INV-1',
      date: 'invalid',
      body: 'Invoice number: INV-1\nAmount paid: 12.00 EUR',
      attachment: { name: '../../invoice.pdf', content: 'fixture attachment' },
    }),
  );
  server.add('INBOX', raw, ['\\Seen'], new Date('2026-03-10'));
  const fakeClient = new FakeImapClient(server);
  const client = fakeClient as unknown as ImapClient;
  await client.connect();
  const scope = { projectKey: 'REVIEW', folder: 'INBOX' };
  const manifest = await inspectReceiptHistory(client, account!, {
    ...scope,
    since: '2026-01-01',
    before: '2026-04-01',
  });
  const parent = await mkdtemp(path.join(tmpdir(), 'mail-receipt-review-'));
  const input = { ...scope, outputDir: path.join(parent, 'export') };
  return { account: account!, server, box, client, fakeClient, manifest, raw, parent, input };
}

it('exports private exact originals, body and metadata without mail, receipt or provider mutations', async () => {
  const { account, server, client, manifest, raw, input } = await setup();
  manifest.candidates[0]!.selected = false;
  const vaultBefore = (await readdir(process.env.PROJECT_VAULT_ROOT!, { recursive: true })).sort();
  const getLock = client.getMailboxLock.bind(client);
  const locks: unknown[] = [];
  client.getMailboxLock = async (folder, options) => {
    locks.push(options);
    return getLock(folder, options);
  };
  const result = await exportReceiptHistoryReview(client, account, manifest, input);
  expect(locks).toEqual([{ readOnly: true }]);
  expect(result.exported).toBe(1);
  expect(JSON.stringify(result)).not.toContain('Invoice');
  expect(await readFile(path.join(input.outputDir, '1.eml'))).toEqual(raw);
  expect(await readFile(path.join(input.outputDir, '1.body.txt'), 'utf8')).toContain(
    'Amount paid: 12.00 EUR',
  );
  const metadata = JSON.parse(
    await readFile(path.join(input.outputDir, '1.metadata.json'), 'utf8'),
  );
  expect(metadata.date).toMatchObject({
    status: 'invalid',
    headerValues: ['invalid'],
    internalDate: '2026-03-10T00:00:00.000Z',
  });
  expect(metadata.date.warning).toContain('not verified');
  expect(metadata.attachments[0]).toMatchObject({ sha256: sha256('fixture attachment'), size: 18 });
  expect((await stat(input.outputDir)).mode & 0o777).toBe(0o700);
  const names = await readdir(input.outputDir);
  expect(names.sort()).toEqual([
    '1.body.txt',
    '1.eml',
    '1.metadata.json',
    'SHA256SUMS',
    'inspected-manifest.json',
    'review-manifest.json',
  ]);
  for (const name of names)
    expect((await stat(path.join(input.outputDir, name))).mode & 0o777).toBe(0o600);
  for (const line of (await readFile(result.sha256Path, 'utf8')).trim().split('\n')) {
    const [hash, filename] = line.split('  ');
    expect(sha256(await readFile(path.join(input.outputDir, filename!)))).toBe(hash);
  }
  const exported = JSON.parse(await readFile(result.manifestPath, 'utf8'));
  expect(exported).toMatchObject({
    accountId: account.id,
    projectKey: 'REVIEW',
    folder: 'INBOX',
    uidValidity: manifest.uidValidity,
    messages: [{ uid: 1, sha256: sha256(raw), dateStatus: 'invalid' }],
  });
  expect(exported.inspectedManifestSha256).toBe(
    sha256(await readFile(path.join(input.outputDir, 'inspected-manifest.json'))),
  );
  expect(await db.select().from(mailMessage)).toHaveLength(0);
  expect(await db.select().from(mailThread)).toHaveLength(0);
  expect(await db.select().from(helenaReceipt)).toHaveLength(0);
  expect(await db.select().from(hubInboxEvent)).toHaveLength(0);
  expect(await db.select().from(mailMessageFolder)).toHaveLength(0);
  expect((await readdir(process.env.PROJECT_VAULT_ROOT!, { recursive: true })).sort()).toEqual(
    vaultBefore,
  );
  expect(server.flagsOf('INBOX', '<invoice@fixture.example>')).toEqual(['\\Seen']);
  expect(server.messageIdsIn('INBOX')).toEqual(['<invoice@fixture.example>']);
});

it('requires the inspected account, project, folder and provider UID validity', async () => {
  const { account, box, client, manifest, input, server } = await setup();
  const before = server.sourceFetches;
  await expect(
    exportReceiptHistoryReview(client, account, { ...manifest, accountId: account.id + 1 }, input),
  ).rejects.toThrow('Mailbox does not match');
  await expect(
    exportReceiptHistoryReview(client, account, { ...manifest, projectKey: 'OTHER' }, input),
  ).rejects.toThrow('project scope');
  await expect(
    exportReceiptHistoryReview(client, account, manifest, { ...input, folder: 'Other' }),
  ).rejects.toThrow('folder does not match');
  box.uidValidity++;
  await expect(exportReceiptHistoryReview(client, account, manifest, input)).rejects.toThrow(
    'UID validity',
  );
  expect(server.sourceFetches).toBe(before);
  expect(await readdir(path.dirname(input.outputDir))).toEqual([]);
});

it('rejects changed raw bytes and incomplete provider responses without a completed export', async () => {
  const { account, box, client, manifest, input } = await setup();
  box.messages[0]!.raw = Buffer.from('changed original');
  await expect(exportReceiptHistoryReview(client, account, manifest, input)).rejects.toThrow(
    'Original changed',
  );
  expect(await readdir(input.outputDir)).toEqual(['inspected-manifest.json']);
  box.messages[0]!.uid++;
  await expect(
    exportReceiptHistoryReview(client, account, manifest, {
      ...input,
      outputDir: path.join(path.dirname(input.outputDir), 'missing'),
    }),
  ).rejects.toThrow('Original unavailable');
  expect(await db.select().from(mailMessage)).toHaveLength(0);
});

it('refuses reused output paths, symlink ancestors, public parents and vault or storage destinations', async () => {
  const { account, client, manifest, parent, input } = await setup();
  await mkdir(input.outputDir, { mode: 0o700 });
  await writeFile(path.join(input.outputDir, 'sentinel'), 'unchanged', { mode: 0o600 });
  await expect(exportReceiptHistoryReview(client, account, manifest, input)).rejects.toThrow(
    'already exists',
  );
  expect(await readFile(path.join(input.outputDir, 'sentinel'), 'utf8')).toBe('unchanged');
  await symlink(input.outputDir, path.join(parent, 'link'));
  await expect(
    exportReceiptHistoryReview(client, account, manifest, {
      ...input,
      outputDir: path.join(parent, 'link', 'child'),
    }),
  ).rejects.toThrow('symlink');
  await mkdir(path.join(parent, 'public'), { mode: 0o755 });
  await expect(
    exportReceiptHistoryReview(client, account, manifest, {
      ...input,
      outputDir: path.join(parent, 'public', 'child'),
    }),
  ).rejects.toThrow('0700');
  for (const outputDir of [
    'relative',
    `${parent}/../escape`,
    path.join(process.env.PROJECT_VAULT_ROOT!, 'review'),
    path.join(process.env.STORAGE_ROOT!, 'review'),
  ])
    await expect(
      exportReceiptHistoryReview(client, account, manifest, { ...input, outputDir }),
    ).rejects.toThrow();
});

it('rejects a provider response naming a different UID', async () => {
  const { account, client, manifest, input } = await setup();
  const fetchAll = client.fetchAll.bind(client);
  client.fetchAll = async (...args) => {
    const messages = await fetchAll(...args);
    return args[1].source
      ? messages.map((message) => ({ ...message, uid: message.uid + 1 }))
      : messages;
  };
  await expect(exportReceiptHistoryReview(client, account, manifest, input)).rejects.toThrow(
    'Provider source unavailable',
  );
  expect(await readdir(input.outputDir)).toEqual(['inspected-manifest.json']);
});

it('keeps writes on the opened directory if its path is replaced by a symlink', async () => {
  const { account, client, manifest, parent, input, raw } = await setup();
  const victim = path.join(parent, 'victim');
  const moved = path.join(parent, 'moved');
  await mkdir(victim, { mode: 0o700 });
  await writeFile(path.join(victim, '1.eml'), 'untouched', { mode: 0o600 });
  const fetchAll = client.fetchAll.bind(client);
  let replaced = false;
  client.fetchAll = async (...args) => {
    if (!replaced) {
      await rename(input.outputDir, moved);
      await symlink(victim, input.outputDir);
      replaced = true;
    }
    return fetchAll(...args);
  };
  await expect(exportReceiptHistoryReview(client, account, manifest, input)).rejects.toThrow(
    'directory changed',
  );
  expect(await readFile(path.join(victim, '1.eml'), 'utf8')).toBe('untouched');
  expect(await readdir(victim)).toEqual(['1.eml']);
  expect(await readFile(path.join(moved, '1.eml'))).toEqual(raw);
  expect(await readdir(moved)).not.toContain('SHA256SUMS');
});

it('bounds candidate count and individual source bytes before fetching originals', async () => {
  const { account, box, client, manifest, input, server } = await setup();
  const before = server.sourceFetches;
  await expect(
    exportReceiptHistoryReview(
      client,
      account,
      {
        ...manifest,
        candidates: Array.from({ length: 51 }, (_, i) => ({
          ...manifest.candidates[0],
          uid: i + 1,
        })),
      },
      input,
    ),
  ).rejects.toThrow();
  await expect(
    exportReceiptHistoryReview(
      client,
      account,
      { ...manifest, candidates: [manifest.candidates[0], manifest.candidates[0]] },
      input,
    ),
  ).rejects.toThrow('duplicate UIDs');
  box.messages[0]!.raw = Buffer.alloc(25 * 1024 * 1024 + 1);
  await expect(exportReceiptHistoryReview(client, account, manifest, input)).rejects.toThrow(
    'exceeds limits',
  );
  expect(server.sourceFetches).toBe(before);
  expect(await readdir(input.outputDir)).toEqual(['inspected-manifest.json']);
  const fetchAll = client.fetchAll.bind(client);
  client.fetchAll = async (...args) => {
    const messages = await fetchAll(...args);
    return args[1].source ? messages : messages.map((message) => ({ ...message, size: 1 }));
  };
  manifest.candidates[0]!.sha256 = sha256(box.messages[0]!.raw);
  await expect(
    exportReceiptHistoryReview(client, account, manifest, {
      ...input,
      outputDir: path.join(path.dirname(input.outputDir), 'oversized-source'),
    }),
  ).rejects.toThrow('Provider source unavailable or exceeds limits');
  expect(server.sourceFetches).toBe(before + 1);
});

it('caps the entire review output at 100 MiB, including readable companion files', async () => {
  const { account, box, client, manifest, input, server } = await setup();
  const raw = Buffer.concat([
    Buffer.from('Subject: Invoice\r\n\r\n'),
    Buffer.alloc(20 * 1024 * 1024, 'x'),
  ]).subarray(0, 20 * 1024 * 1024);
  box.messages[0]!.raw = raw;
  for (let i = 0; i < 4; i++) server.add('INBOX', raw, [], new Date('2026-03-10'));
  const candidates = box.messages.map((message) => ({
    ...manifest.candidates[0]!,
    uid: message.uid,
    sha256: sha256(raw),
  }));
  await expect(
    exportReceiptHistoryReview(client, account, { ...manifest, candidates }, input),
  ).rejects.toThrow('batch limit');
  const files = await readdir(input.outputDir);
  let bytes = 0;
  for (const file of files) bytes += (await stat(path.join(input.outputDir, file))).size;
  expect(bytes).toBeLessThanOrEqual(MAX_BATCH_BYTES);
  expect(files).not.toContain('SHA256SUMS');
  expect(await db.select().from(mailMessage)).toHaveLength(0);
}, 30_000);
