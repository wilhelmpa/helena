import { describe, expect, it } from 'bun:test';
import { bindsReceiptMail, receiptMailReference, type ReceiptOrigin } from './receipt-origin';

const hash = 'a'.repeat(64);
const message = {
  id: 7,
  teamId: 1,
  accountId: 2,
  threadId: 3,
  rawKey: `mail/2/${hash}.eml`,
  size: 100,
};
const thread = { id: 3, teamId: 1, accountId: 2, projectId: 4 };
const account = { id: 2, teamId: 1 };
const attachment = { id: 8, messageId: 7, sha256: hash, size: 100 };
const receipt: ReceiptOrigin = {
  source: 'mail',
  teamId: 1,
  projectId: 4,
  mailAttachmentId: 8,
  sha256: hash,
  size: 100,
  contentType: 'application/pdf',
  details: {},
};
const body: ReceiptOrigin = {
  ...receipt,
  mailAttachmentId: null,
  contentType: 'message/rfc822',
  details: { mailSource: { messageId: 7, threadId: 3, kind: 'body' } },
};
const bound = (r = receipt, m = message, t = thread, a = account, attachments = [attachment]) =>
  bindsReceiptMail(r, m, t, a, attachments);

describe('receipt-bound single mail original', () => {
  it('accepts authoritative legacy FK without JSON and strictly bound body EML', () => {
    expect(bound()).toBe(true);
    expect(bound(body)).toBe(true);
    expect(
      bound({
        ...body,
        contentType: 'application/pdf',
        details: { mailSource: { messageId: 7, threadId: 3, kind: 'attachment' } },
      }),
    ).toBe(true);
  });
  it('does not use JSON to bypass an invalid authoritative attachment FK', () => {
    expect(bound({ ...body, mailAttachmentId: 99 })).toBe(false);
    expect(
      bound({ ...body, mailAttachmentId: 8 }, message, thread, account, [
        { ...attachment, sha256: 'b'.repeat(64) },
      ]),
    ).toBe(false);
  });
  it('requires exact SHA, size and message for attachment provenance', () => {
    for (const a of [
      { ...attachment, sha256: 'b'.repeat(64) },
      { ...attachment, size: 99 },
      { ...attachment, messageId: 9 },
    ])
      expect(bound(receipt, message, thread, account, [a])).toBe(false);
  });
  it('requires raw EML hash-key, byte size and media type for body provenance', () => {
    expect(bound(body, { ...message, rawKey: 'mail/2/other.eml' })).toBe(false);
    expect(bound(body, { ...message, size: 101 })).toBe(false);
    expect(bound({ ...body, contentType: 'application/pdf' })).toBe(false);
  });
  it('rejects cross-project, team, account, thread and uploaded receipts', () => {
    for (const r of [
      { ...receipt, source: 'upload' },
      { ...receipt, projectId: 9 },
      { ...receipt, teamId: 9 },
    ])
      expect(bound(r)).toBe(false);
    expect(bound(receipt, { ...message, teamId: 9 })).toBe(false);
    expect(bound(receipt, { ...message, accountId: 9 })).toBe(false);
    expect(bound(receipt, { ...message, threadId: 9 })).toBe(false);
    expect(bound(receipt, message, { ...thread, teamId: 9 })).toBe(false);
    expect(bound(receipt, message, { ...thread, accountId: 9 })).toBe(false);
    expect(bound(receipt, message, thread, { ...account, teamId: 9 })).toBe(false);
  });
  it('never derives access from malformed JSON or another message in the same thread', () => {
    for (const value of [
      null,
      [],
      '7',
      { messageId: '7', threadId: 3, kind: 'body' },
      { messageId: 7, threadId: 3 },
      { messageId: 7, threadId: 3, kind: ['body'] },
      { messageId: 7.5, threadId: 3, kind: 'body' },
      { messageId: 7, threadId: 2147483648, kind: 'body' },
      { messageId: 0, threadId: 3, kind: 'body' },
    ]) {
      expect(receiptMailReference({ mailSource: value })).toBeNull();
      expect(bound({ ...body, details: { mailSource: value } })).toBe(false);
    }
    expect(bound(body, { ...message, id: 9 })).toBe(false);
  });
});
