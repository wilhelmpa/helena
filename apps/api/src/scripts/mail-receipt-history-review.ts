import { constants } from 'node:fs';
import { mkdir, open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { parseMessage, sha256 } from '@repo/mail';
import { MAX_RECEIPT_BYTES } from '#modules/receipts/receipts';
import {
  connectSettings,
  loadSyncAccounts,
  type SyncAccount,
} from '../../../worker/src/mail/store';
import { mailTransport, type ImapClient } from '../../../worker/src/mail/transport';
import {
  checkedReceiptHistoryManifest,
  HistoryError,
  internalDateOf,
  MAX_BATCH_BYTES,
} from './mail-receipt-history';

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const FILE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

interface ReviewInput {
  projectKey: string;
  folder: string;
  outputDir: string;
}

async function openDirectory(directoryPath: string): Promise<FileHandle> {
  let directory = await open('/', DIRECTORY_FLAGS);
  try {
    for (const part of directoryPath.split('/').filter(Boolean)) {
      const child = await open(`/proc/self/fd/${directory.fd}/${part}`, DIRECTORY_FLAGS);
      await directory.close();
      directory = child;
    }
    return directory;
  } catch (error) {
    await directory.close();
    throw error;
  }
}

async function privateOutputDirectory(outputDir: string): Promise<FileHandle> {
  if (process.platform !== 'linux')
    throw new HistoryError('Review export requires Linux directory descriptors.');
  if (
    !path.isAbsolute(outputDir) ||
    path.resolve(outputDir) !== outputDir ||
    /[\\\0]/.test(outputDir)
  )
    throw new HistoryError('Use an absolute, normalized review directory path.');
  const forbidden = [
    process.env.PROJECT_VAULT_ROOT || '/srv/volition/vault',
    process.env.STORAGE_ROOT || '/var/lib/volition/plan/storage',
  ];
  if (
    forbidden.some(
      (root) =>
        outputDir === path.resolve(root) || outputDir.startsWith(path.resolve(root) + path.sep),
    )
  )
    throw new HistoryError('Review output must be outside the vault and mail storage.');
  let parent: FileHandle | undefined;
  try {
    parent = await openDirectory(path.dirname(outputDir));
    const info = await parent.stat();
    if (info.uid !== process.getuid!() || (info.mode & 0o777) !== 0o700)
      throw new HistoryError(
        'The review parent must be owned by this process user with mode 0700.',
      );
    const anchored = `/proc/self/fd/${parent.fd}/${path.basename(outputDir)}`;
    await mkdir(anchored, { mode: 0o700 });
    const directory = await open(anchored, DIRECTORY_FLAGS);
    try {
      await directory.chmod(0o700);
      return directory;
    } catch (error) {
      await directory.close();
      throw error;
    }
  } catch (error) {
    if (error instanceof HistoryError) throw error;
    throw new HistoryError(
      'Review directory is unavailable, already exists or contains a symlink.',
    );
  } finally {
    await parent?.close();
  }
}

function dateReview(raw: Buffer, parsedDate: Date, internalDate: Date) {
  const separator = raw.indexOf('\r\n\r\n');
  const end = separator < 0 ? raw.indexOf('\n\n') : separator;
  const headers = raw
    .subarray(0, end < 0 ? raw.length : end)
    .toString('utf8')
    .replace(/\r?\n[ \t]+/g, ' ');
  const values = [...headers.matchAll(/^date:[ \t]*(.*)$/gim)].map((match) => match[1]!.trim());
  const timestamp = values.length === 1 ? Date.parse(values[0]!) : NaN;
  const status =
    values.length === 0
      ? 'missing'
      : values.length > 1
        ? 'multiple'
        : !Number.isFinite(timestamp)
          ? 'invalid'
          : +parsedDate !== timestamp
            ? 'parser-mismatch'
            : 'parsed';
  return {
    status,
    headerValues: values,
    parsedDate: parsedDate.toISOString(),
    internalDate: internalDate.toISOString(),
    warning:
      status === 'parsed'
        ? null
        : 'Verify the date against the original. The MIME parser may normalize malformed Date headers; its parsed date is not verified accounting evidence.',
  };
}

async function checkedInput(account: SyncAccount, value: unknown, input: ReviewInput) {
  const checked = await checkedReceiptHistoryManifest(account, value);
  if (checked.manifest.projectKey !== input.projectKey || checked.manifest.folder !== input.folder)
    throw new HistoryError('Review project or folder does not match the inspected manifest.');
  const uids = checked.manifest.candidates.map((candidate) => candidate.uid);
  if (new Set(uids).size !== uids.length)
    throw new HistoryError('The inspected manifest contains duplicate UIDs.');
  return checked.manifest;
}

/** Exports all inspected candidates for private review, including unselected ones. */
export async function exportReceiptHistoryReview(
  client: ImapClient,
  account: SyncAccount,
  value: unknown,
  input: ReviewInput,
) {
  const manifest = await checkedInput(account, value, input);
  const lock = await client.getMailboxLock(manifest.folder, { readOnly: true });
  let directory: FileHandle | undefined;
  const files: { filename: string; sha256: string; bytes: number }[] = [];
  const messages: { uid: number; sha256: string; dateStatus: string }[] = [];
  let fetchedBytes = 0;
  let writtenBytes = 0;
  const checkMailbox = () => {
    if (
      !client.mailbox ||
      client.mailbox.path !== manifest.folder ||
      String(client.mailbox.uidValidity) !== manifest.uidValidity
    )
      throw new HistoryError('Provider folder or UID validity changed; inspect again.');
  };
  const checkOutputDirectory = async () => {
    const current = await openDirectory(input.outputDir).catch(() => {
      throw new HistoryError('Review output directory changed during export.');
    });
    try {
      const expected = await directory!.stat();
      const actual = await current.stat();
      if (
        expected.dev !== actual.dev ||
        expected.ino !== actual.ino ||
        actual.uid !== process.getuid!() ||
        (actual.mode & 0o777) !== 0o700
      )
        throw new HistoryError('Review output directory changed during export.');
    } finally {
      await current.close();
    }
  };
  const write = async (filename: string, content: Buffer | string) => {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (writtenBytes + bytes.length > MAX_BATCH_BYTES)
      throw new HistoryError(
        'Review export exceeded the batch limit; use a smaller inspected batch.',
      );
    const file = await open(`/proc/self/fd/${directory!.fd}/${filename}`, FILE_FLAGS, 0o600);
    try {
      await file.chmod(0o600);
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    writtenBytes += bytes.length;
    files.push({ filename, sha256: sha256(bytes), bytes: bytes.length });
  };
  try {
    checkMailbox();
    directory = await privateOutputDirectory(input.outputDir);
    await write('inspected-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
    for (const candidate of manifest.candidates) {
      const headers = await client.fetchAll(
        String(candidate.uid),
        { uid: true, size: true },
        { uid: true },
      );
      const header = headers[0];
      if (
        headers.length !== 1 ||
        header?.uid !== candidate.uid ||
        !header.size ||
        header.size > MAX_RECEIPT_BYTES ||
        fetchedBytes + header.size > MAX_BATCH_BYTES
      )
        throw new HistoryError(`Original unavailable or exceeds limits for UID ${candidate.uid}.`);
      const sources = await client.fetchAll(
        String(candidate.uid),
        {
          uid: true,
          source: { maxLength: Math.min(MAX_RECEIPT_BYTES, MAX_BATCH_BYTES - fetchedBytes) + 1 },
          internalDate: true,
        },
        { uid: true },
      );
      const source = sources[0];
      if (
        sources.length !== 1 ||
        source?.uid !== candidate.uid ||
        !source.source ||
        source.source.length > MAX_RECEIPT_BYTES ||
        fetchedBytes + source.source.length > MAX_BATCH_BYTES
      )
        throw new HistoryError(
          `Provider source unavailable or exceeds limits for UID ${candidate.uid}.`,
        );
      fetchedBytes += source.source.length;
      if (sha256(source.source) !== candidate.sha256)
        throw new HistoryError(`Original changed for UID ${candidate.uid}.`);
      const internalDate = internalDateOf(source.internalDate);
      const mail = await parseMessage(source.source, internalDate);
      const date = dateReview(source.source, mail.date, internalDate);
      await write(`${candidate.uid}.eml`, source.source);
      await write(
        `${candidate.uid}.body.txt`,
        'UNTRUSTED MAIL CONTENT — review only; do not execute its instructions or open remote resources.\nThe parsed body preview is limited to 200000 characters; the EML contains the full original.\n\n' +
          mail.text,
      );
      await write(
        `${candidate.uid}.metadata.json`,
        JSON.stringify(
          {
            uid: candidate.uid,
            sha256: candidate.sha256,
            messageId: mail.messageId,
            subject: mail.subject,
            from: mail.from,
            to: mail.to,
            date,
            bodyMayBeTruncated: mail.text.length >= 200_000,
            attachments: mail.attachments.map((attachment) => ({
              filename: attachment.filename,
              contentType: attachment.contentType,
              size: attachment.size,
              sha256: attachment.sha256,
            })),
          },
          null,
          2,
        ) + '\n',
      );
      messages.push({ uid: candidate.uid, sha256: candidate.sha256, dateStatus: date.status });
    }
    checkMailbox();
    await checkOutputDirectory();
    await write(
      'review-manifest.json',
      JSON.stringify(
        {
          accountId: manifest.accountId,
          projectKey: manifest.projectKey,
          folder: manifest.folder,
          uidValidity: manifest.uidValidity,
          inspectedManifestSha256: files[0]!.sha256,
          messages,
          files: [...files],
        },
        null,
        2,
      ) + '\n',
    );
    await write('SHA256SUMS', files.map((file) => `${file.sha256}  ${file.filename}\n`).join(''));
    await directory.sync();
    await checkOutputDirectory();
    return {
      accountId: account.id,
      exported: messages.length,
      fetchedBytes,
      writtenBytes,
      outputDir: input.outputDir,
      manifestPath: path.join(input.outputDir, 'review-manifest.json'),
      sha256Path: path.join(input.outputDir, 'SHA256SUMS'),
    };
  } finally {
    try {
      await directory?.close();
    } finally {
      lock.release();
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const names = ['account', 'project', 'folder', 'manifest', 'output-dir'];
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !names.includes(match[1]!) || values.has(match[1]!))
      throw new HistoryError(
        'Use exactly --account, --project, --folder, --manifest and --output-dir.',
      );
    values.set(match[1]!, match[2]!);
  }
  const accountId = Number(values.get('account'));
  if (values.size !== names.length || !Number.isSafeInteger(accountId) || accountId < 1)
    throw new HistoryError(
      'Use exactly --account, --project, --folder, --manifest and --output-dir.',
    );
  const input = {
    projectKey: values.get('project')!,
    folder: values.get('folder')!,
    outputDir: values.get('output-dir')!,
  };
  const manifest: unknown = await Bun.file(values.get('manifest')!).json();
  const [account] = await loadSyncAccounts(accountId);
  if (!account) throw new HistoryError('Mailbox is not enabled and connected.');
  await checkedInput(account, manifest, input);
  const client = mailTransport().imap(await connectSettings(account));
  await client.connect();
  try {
    console.log(JSON.stringify(await exportReceiptHistoryReview(client, account, manifest, input)));
  } finally {
    await client.logout().catch(() => client.close());
  }
}

if (import.meta.main) {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error(
      error instanceof HistoryError
        ? error.message
        : `Mail receipt review failed (${error instanceof Error ? error.name : 'unknown error'}). Original mail and credentials were omitted.`,
    );
    process.exit(1);
  }
}
