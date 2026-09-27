/** A receipt grants access to one original message, never to its whole thread. */
export type ReceiptOrigin = {
  source: string;
  teamId: number;
  projectId: number;
  mailAttachmentId: number | null;
  sha256: string;
  size: number;
  contentType: string;
  details: unknown;
};
export type OriginMessage = {
  id: number;
  teamId: number;
  accountId: number;
  threadId: number;
  rawKey: string;
  size: number;
};
export type OriginAttachment = { id: number; messageId: number; sha256: string; size: number };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function id(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
}
export function receiptMailReference(details: unknown) {
  const value = record(record(details)?.mailSource);
  if (
    !value ||
    !id(value.messageId) ||
    !id(value.threadId) ||
    (value.kind !== 'attachment' && value.kind !== 'body')
  )
    return null;
  return {
    messageId: value.messageId,
    threadId: value.threadId,
    kind: value.kind as 'attachment' | 'body',
  };
}

export function bindsReceiptMail(
  receipt: ReceiptOrigin,
  message: OriginMessage,
  thread: { id: number; teamId: number; accountId: number; projectId: number | null },
  account: { id: number; teamId: number },
  attachments: OriginAttachment[],
): boolean {
  if (
    receipt.source !== 'mail' ||
    !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
    !Number.isSafeInteger(receipt.size) ||
    receipt.size < 0 ||
    receipt.teamId !== message.teamId ||
    receipt.teamId !== thread.teamId ||
    receipt.teamId !== account.teamId ||
    receipt.projectId !== thread.projectId ||
    message.threadId !== thread.id ||
    message.accountId !== thread.accountId ||
    message.accountId !== account.id
  )
    return false;
  const matches = (a: OriginAttachment) =>
    a.messageId === message.id && a.sha256 === receipt.sha256 && a.size === receipt.size;
  // A present FK is authoritative; an invalid one must never fall through to JSON.
  if (receipt.mailAttachmentId !== null)
    return attachments.some((a) => a.id === receipt.mailAttachmentId && matches(a));
  const reference = receiptMailReference(receipt.details);
  if (reference?.messageId !== message.id || reference.threadId !== message.threadId) return false;
  if (reference.kind === 'attachment') return attachments.some(matches);
  return (
    receipt.contentType === 'message/rfc822' &&
    message.size === receipt.size &&
    message.rawKey === `mail/${message.accountId}/${receipt.sha256}.eml`
  );
}
