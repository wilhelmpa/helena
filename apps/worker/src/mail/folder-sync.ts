import { normalizeMessageId, type FetchMessageObject } from '@repo/mail';
import { importRawMessage } from './import';
import {
  addLocation,
  applyServerFlags,
  clearFolder,
  flagsOf,
  knownUids,
  messageIdsOf,
  removeLocations,
  saveFolderState,
  setFolderValidity,
  updateSyncedCount,
  type FolderRow,
  type SyncAccount,
} from './store';
import type { ImapClient, MailSyncConfig } from './transport';

const HEADER_BATCH = 200;
const FULL_FLAG_FETCH_LIMIT = 5000;

// One bulk import at a time across all accounts, so a first import of several
// accounts does not download in parallel.
let importQueue: Promise<void> = Promise.resolve();

function withImportSlot<T>(work: () => Promise<T>): Promise<T> {
  const run = importQueue.then(work);
  importQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface FolderSyncOptions {
  config: MailSyncConfig;
  // Runs after each batch, with no folder selected: pending changes are pushed there.
  between: () => Promise<void>;
  stopped: () => boolean;
}

async function searchUids(client: ImapClient, query: Record<string, unknown>): Promise<number[]> {
  const result = await client.search(query, { uid: true });
  return Array.isArray(result) ? result : [];
}

interface MailboxState {
  uidValidity: number;
  uidNext: number;
  exists: number;
  highestModseq: string | null;
}

async function openFolder(client: ImapClient, path: string) {
  const lock = await client.getMailboxLock(path);
  const box = client.mailbox;
  if (!box) {
    lock.release();
    throw new Error(`Folder ${path} could not be opened`);
  }
  const state: MailboxState = {
    uidValidity: Number(box.uidValidity),
    uidNext: box.uidNext,
    exists: box.exists,
    highestModseq: box.highestModseq?.toString() ?? null,
  };
  return { lock, state };
}

// Brings one folder up to date: new messages (newest first, in batches), messages
// that left the folder, and flag changes. The folder's UIDNEXT is stored only once a
// pass is complete, so an interrupted import resumes where it stopped: the stored
// locations are the checkpoint.
export async function syncFolder(
  client: ImapClient,
  account: SyncAccount,
  folder: FolderRow,
  options: FolderSyncOptions,
): Promise<void> {
  const opened = await openFolder(client, folder.path);
  const state = opened.state;
  let lock = opened.lock;
  try {
    if (folder.uidValidity != null && folder.uidValidity !== state.uidValidity) {
      await clearFolder(folder.id);
      folder = { ...folder, uidValidity: null, uidNext: 0, highestModseq: null };
    }
    if (folder.uidValidity == null) await setFolderValidity(folder.id, state.uidValidity);
    const unchanged =
      folder.uidValidity === state.uidValidity &&
      folder.uidNext === state.uidNext &&
      folder.totalCount === state.exists &&
      folder.syncedCount === state.exists &&
      (state.highestModseq
        ? state.highestModseq === folder.highestModseq
        : folder.role !== 'inbox');
    if (unchanged) return;

    const known = await knownUids(folder.id);
    // "n:*" also matches the newest message when its UID is below n.
    const fresh =
      folder.uidNext > 0
        ? (await searchUids(client, { uid: `${folder.uidNext}:*` })).filter(
            (uid) => uid >= folder.uidNext && !known.has(uid),
          )
        : [];
    const complete = folder.uidNext > 0 && known.size + fresh.length === state.exists;
    let missing = fresh;
    if (!complete) {
      const server = await searchUids(client, { all: true });
      const onServer = new Set(server);
      const gone = [...known].filter((uid) => !onServer.has(uid));
      if (gone.length > 0) await removeLocations(folder.id, gone);
      missing = server.filter((uid) => !known.has(uid));
    }
    missing.sort((left, right) => right - left);
    const newFrom = folder.role === 'inbox' && folder.uidNext > 0 ? folder.uidNext : Infinity;

    for (let start = 0; start < missing.length; start += HEADER_BATCH) {
      if (options.stopped()) return;
      await importUids(client, account, folder, missing.slice(start, start + HEADER_BATCH), {
        newFrom,
        config: options.config,
      });
      await updateSyncedCount(folder.id, state.exists);
      if (start + HEADER_BATCH >= missing.length) break;
      lock.release();
      await options.between();
      const reopened = await openFolder(client, folder.path);
      lock = reopened.lock;
      if (reopened.state.uidValidity !== state.uidValidity) return;
    }

    await syncFlags(client, folder, state);
    await saveFolderState(folder.id, {
      uidValidity: state.uidValidity,
      uidNext: state.uidNext,
      highestModseq: state.highestModseq,
      totalCount: state.exists,
    });
  } finally {
    lock.release();
  }
}

// Fetches the headers of a batch first: a message the account already has (Gmail
// lists it in All Mail and in each label) only gains the location. The rest is
// downloaded in groups bounded by count and size.
async function importUids(
  client: ImapClient,
  account: SyncAccount,
  folder: FolderRow,
  uids: number[],
  { newFrom, config }: { newFrom: number; config: MailSyncConfig },
): Promise<void> {
  const headers = await client.fetchAll(
    uids.join(','),
    { uid: true, flags: true, envelope: true, size: true, internalDate: true },
    { uid: true },
  );
  const ids = headers.flatMap((header) => {
    const id = normalizeMessageId(header.envelope?.messageId);
    return id ? [id] : [];
  });
  const stored = await messageIdsOf(account.id, ids);
  const download: FetchMessageObject[] = [];
  for (const header of headers) {
    const id = normalizeMessageId(header.envelope?.messageId);
    const known = id ? stored.get(id) : undefined;
    if (known != null) await addLocation(folder.id, header.uid, known, flagsOf(header.flags));
    else download.push(header);
  }
  const byUid = new Map(download.map((header) => [header.uid, header]));
  for (const group of sizeGroups(download, config)) {
    await withImportSlot(async () => {
      const messages = await client.fetchAll(
        group.join(','),
        { uid: true, source: true },
        { uid: true },
      );
      for (const message of messages) {
        const header = byUid.get(message.uid);
        if (!message.source || !header) continue;
        try {
          await importRawMessage(account, message.source, {
            folderId: folder.id,
            uid: message.uid,
            flags: flagsOf(header.flags),
            internalDate: header.internalDate ? new Date(header.internalDate) : undefined,
            newInboxMail: message.uid >= newFrom,
          });
        } catch (error) {
          console.error(
            `[mail] account ${account.id}: message ${message.uid} of ${folder.path} was not imported:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
      await sleep(config.pauseMs);
    });
  }
}

function sizeGroups(headers: FetchMessageObject[], config: MailSyncConfig): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  let bytes = 0;
  for (const header of headers) {
    const size = header.size ?? 0;
    if (
      current.length > 0 &&
      (current.length >= config.batchSize || bytes + size > config.batchBytes)
    ) {
      groups.push(current);
      current = [];
      bytes = 0;
    }
    current.push(header.uid);
    bytes += size;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// Flag changes made on the server. With CONDSTORE only what changed since the last
// pass is fetched; without it the flags of the inbox and of small folders are read in
// full.
async function syncFlags(client: ImapClient, folder: FolderRow, state: MailboxState) {
  if (state.exists === 0) return;
  const condstore = client.enabled.has('CONDSTORE') && folder.highestModseq && state.highestModseq;
  if (condstore && state.highestModseq === folder.highestModseq) return;
  if (!condstore && folder.role !== 'inbox' && state.exists > FULL_FLAG_FETCH_LIMIT) return;
  const changed = await client.fetchAll(
    '1:*',
    { uid: true, flags: true },
    condstore ? { uid: true, changedSince: BigInt(folder.highestModseq!) } : { uid: true },
  );
  await applyServerFlags(
    folder.id,
    changed.map((message) => ({ uid: message.uid, flags: flagsOf(message.flags) })),
  );
}
