import { createHash } from 'node:crypto';
import { convert } from 'html-to-text';
import { simpleParser, type AddressObject, type Attachment } from 'mailparser';
import { extensionForMime } from '@repo/storage/mime';
import { sanitizeMailHtml } from './sanitize';
import { safeFileName } from './vault-path';

export interface MailAddress {
  name: string;
  address: string;
}

export interface ParsedAttachment {
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  contentId: string | null;
  content: Buffer;
}

export interface ParsedMessage {
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  replyTo: MailAddress[];
  date: Date;
  text: string;
  html: string | null;
  hasRemoteImages: boolean;
  snippet: string;
  // Files the sender attached. Inline parts (cid: images, signature logos) are left
  // out; they stay in the .eml and are served from there.
  attachments: ParsedAttachment[];
}

const TINY_INLINE_IMAGE_BYTES = 16 * 1024;
const MAX_TEXT_CHARS = 200_000;

function addresses(value: AddressObject | AddressObject[] | undefined): MailAddress[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .flatMap((entry) =>
      entry.value.flatMap((item) => {
        if (item.group) return item.group.map((member) => address(member.name, member.address));
        return [address(item.name, item.address)];
      }),
    )
    .filter((item) => item.address);
}

function address(name: string | undefined, value: string | undefined): MailAddress {
  return { name: (name ?? '').trim(), address: (value ?? '').trim().toLowerCase() };
}

export function normalizeMessageId(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const inner = trimmed.replace(/^<|>$/g, '').trim();
  return inner ? `<${inner}>` : null;
}

function referenceList(value: string[] | string | undefined): string[] {
  const raw = Array.isArray(value) ? value : value ? value.split(/\s+/) : [];
  return raw.flatMap((item) => {
    const id = normalizeMessageId(item);
    return id ? [id] : [];
  });
}

export function snippetOf(text: string): string {
  const lines = text.split('\n').filter((line) => !line.trimStart().startsWith('>'));
  return lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function isRealAttachment(attachment: Attachment, html: string | null): boolean {
  if (attachment.related) return false;
  if (attachment.cid && html?.includes(`cid:${attachment.cid}`)) return false;
  const image = attachment.contentType.startsWith('image/');
  const inline = attachment.contentDisposition === 'inline' || Boolean(attachment.cid);
  return !(image && inline && attachment.size < TINY_INLINE_IMAGE_BYTES);
}

function attachmentName(attachment: Attachment, index: number): string {
  const extension = extensionForMime(attachment.contentType);
  return safeFileName(attachment.filename ?? '', `attachment-${index + 1}${extension}`);
}

export function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

// The text of an HTML-only message, for search and the snippet: no link targets, no
// image addresses and headings in their own case.
export function htmlText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
      ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((selector) => ({
        selector,
        options: { uppercase: false },
      })),
      { selector: 'table', format: 'dataTable', options: { uppercaseHeaderCells: false } },
    ],
  });
}

export async function parseMessage(raw: Buffer, fallbackDate = new Date()): Promise<ParsedMessage> {
  const mail = await simpleParser(raw, {
    skipHtmlToText: true,
    skipImageLinks: true,
    skipTextToHtml: true,
    skipTextLinks: true,
  });
  const sanitized = mail.html ? sanitizeMailHtml(mail.html) : null;
  const text = (mail.text?.trim() ? mail.text : sanitized ? htmlText(sanitized.html) : '').slice(
    0,
    MAX_TEXT_CHARS,
  );
  const from = addresses(mail.from)[0] ?? null;
  const rawHtml = mail.html || null;
  return {
    messageId: normalizeMessageId(mail.messageId) ?? `<${sha256(raw)}@plan.local>`,
    inReplyTo: normalizeMessageId(mail.inReplyTo),
    references: referenceList(mail.references),
    subject: (mail.subject ?? '').trim(),
    from,
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    bcc: addresses(mail.bcc),
    replyTo: addresses(mail.replyTo),
    date: mail.date && Number.isFinite(mail.date.getTime()) ? mail.date : fallbackDate,
    text,
    html: sanitized?.html ?? null,
    hasRemoteImages: sanitized?.hasRemoteImages ?? false,
    snippet: snippetOf(text),
    attachments: mail.attachments
      .filter((attachment) => isRealAttachment(attachment, rawHtml))
      .map((attachment, index) => ({
        filename: attachmentName(attachment, index),
        contentType: attachment.contentType.toLowerCase(),
        size: attachment.content.length,
        sha256: sha256(attachment.content),
        contentId: attachment.cid ?? null,
        content: attachment.content,
      })),
  };
}

// The part of a message with the given Content-ID, for serving a cid: image.
export async function findInlinePart(
  raw: Buffer,
  contentId: string,
): Promise<{ contentType: string; content: Buffer } | null> {
  const mail = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
  const part = mail.attachments.find((attachment) => attachment.cid === contentId);
  return part ? { contentType: part.contentType, content: part.content } : null;
}

// The thread a message starts or joins: the first id of References names the root,
// In-Reply-To is the fallback, and a message without either starts its own thread.
export function threadKeyOf(
  message: Pick<ParsedMessage, 'messageId' | 'inReplyTo' | 'references'>,
): string {
  return message.references[0] ?? message.inReplyTo ?? message.messageId;
}
