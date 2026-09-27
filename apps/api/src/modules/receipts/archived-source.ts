import { getObject } from '@repo/storage';
import { htmlText, parseMessage, sanitizeMailHtml, sha256 } from '@repo/mail';
import { assertMailAccess } from '#modules/mail/access';
import type { AuthUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { requireReceipt } from './receipts';
import { resolveReceiptMail } from './source';

/** The caller must pass the normal receipt-read route guard as well as mail access. */
export async function receiptOriginalMail(
  projectId: number,
  receiptId: number,
  user: AuthUser,
  headers: Headers,
) {
  const receipt = await requireReceipt(projectId, receiptId);
  await assertMailAccess(receipt.teamId, receipt.projectId, user, 'read', headers);
  const source = await resolveReceiptMail(receipt);
  if (!source) throw new HttpError(404, 'Receipt source mail unavailable');
  const maxBytes = 25 * 1024 * 1024;
  if (source.message.size > maxBytes) throw new HttpError(413, 'Receipt source mail too large');
  if (
    !new RegExp(`^mail/${source.message.accountId}/[a-f0-9]{64}\\.eml$`).test(source.message.rawKey)
  )
    throw new HttpError(409, 'Receipt source original changed');
  const stored = await getObject(source.message.rawKey);
  const reader = stored.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new HttpError(413, 'Receipt source mail too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const raw = Buffer.concat(chunks);
  if (
    size !== source.message.size ||
    source.message.rawKey !== `mail/${source.message.accountId}/${sha256(raw)}.eml`
  )
    throw new HttpError(409, 'Receipt source original changed');
  const parsed = await parseMessage(raw, source.message.sentAt);
  const originalMatches =
    receipt.contentType === 'message/rfc822' && receipt.mailAttachmentId === null
      ? sha256(raw) === receipt.sha256 && size === receipt.size
      : parsed.attachments.some((a) => a.sha256 === receipt.sha256 && a.size === receipt.size);
  if (!originalMatches) throw new HttpError(409, 'Receipt source original does not match');
  // Plain strings only: no remote resources, HTML actions, draft or thread access.
  return {
    messageId: source.message.id,
    archived: source.message.deletedAt !== null,
    subject: parsed.subject,
    fromName: parsed.from?.name ?? '',
    fromAddress: parsed.from?.address ?? '',
    sentAt: parsed.date.toISOString(),
    text: parsed.text,
    htmlText: parsed.html ? htmlText(sanitizeMailHtml(parsed.html).html) : null,
  };
}
