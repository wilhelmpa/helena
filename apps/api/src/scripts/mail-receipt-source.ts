import type { ImapClient } from '../../../worker/src/mail/transport';

export class HistoryError extends Error {}

type MailboxScope = { folder: string; uidValidity: string };

export function assertHistoryMailbox(client: ImapClient, scope: MailboxScope) {
  if (
    !client.mailbox ||
    client.mailbox.path !== scope.folder ||
    String(client.mailbox.uidValidity) !== scope.uidValidity
  )
    throw new HistoryError('Provider folder or UID validity changed; inspect again.');
}

export async function fetchReceiptHistorySource(
  client: ImapClient,
  scope: MailboxScope,
  uid: number,
  remainingBytes: number,
  maxBytes: number,
) {
  assertHistoryMailbox(client, scope);
  const headers = await client.fetchAll(String(uid), { uid: true, size: true }, { uid: true });
  assertHistoryMailbox(client, scope);
  if (headers.length === 0) return null;
  const header = headers[0]!;
  if (headers.length !== 1 || header.uid !== uid)
    throw new HistoryError(`Provider returned a different UID for ${uid}.`);
  if (
    !Number.isSafeInteger(header.size) ||
    !header.size ||
    header.size < 0 ||
    header.size > Math.min(maxBytes, remainingBytes)
  )
    return null;
  const sources = await client.fetchAll(
    String(uid),
    {
      uid: true,
      source: { maxLength: Math.min(maxBytes, remainingBytes) + 1 },
      flags: true,
      internalDate: true,
    },
    { uid: true },
  );
  assertHistoryMailbox(client, scope);
  const source = sources[0];
  if (
    sources.length !== 1 ||
    source?.uid !== uid ||
    !source.source ||
    source.source.length !== header.size ||
    source.source.length > Math.min(maxBytes, remainingBytes)
  )
    throw new HistoryError(
      `Provider source unavailable or exceeds limits or changed for UID ${uid}.`,
    );
  return { ...source, source: source.source };
}
