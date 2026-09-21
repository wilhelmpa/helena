import type { MailPayload } from '@/lib/api/endpoints/connections';

export interface MailRow {
  id: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
}

export interface MailAttachment {
  messageId: string;
  attachmentId: string;
  filename: string;
  size: number | null;
}

function objects(value: unknown, result: Record<string, unknown>[] = [], depth = 0) {
  if (depth > 10 || !value || typeof value !== 'object') return result;
  if (Array.isArray(value)) {
    for (const item of value) objects(item, result, depth + 1);
  } else {
    const record = value as Record<string, unknown>;
    result.push(record);
    for (const item of Object.values(record)) objects(item, result, depth + 1);
  }
  return result;
}

function string(value: unknown, maximum = 2_000) {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

export function mailRows(payload: MailPayload | undefined, noSubject: string): MailRow[] {
  const seen = new Set<string>();
  const rows: MailRow[] = [];
  for (const item of objects(payload)) {
    const id = string(item.threadId || item.id, 512);
    if (!id || seen.has(id)) continue;
    const subject = string(
      item.subject || (item.headers as Record<string, unknown> | undefined)?.subject,
      998,
    );
    const sender = string(
      item.from || item.sender || (item.headers as Record<string, unknown> | undefined)?.from,
      500,
    );
    const snippet = string(item.snippet || item.body || item.text, 2_000);
    if (!subject && !sender && !snippet) continue;
    seen.add(id);
    rows.push({
      id,
      subject: subject || noSubject,
      sender,
      date: string(item.date || item.receivedAt, 100),
      snippet,
    });
  }
  return rows.slice(0, 50);
}

export function mailAttachments(payload: MailPayload | undefined): MailAttachment[] {
  const result: MailAttachment[] = [];
  const seen = new Set<string>();
  function walk(value: unknown, currentMessageId = '', depth = 0) {
    if (depth > 10 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, currentMessageId, depth + 1);
      return;
    }
    const item = value as Record<string, unknown>;
    const messageId =
      string(item.messageId, 512) ||
      (item.threadId ? string(item.id, 512) : '') ||
      currentMessageId;
    const body =
      item.body && typeof item.body === 'object' ? (item.body as Record<string, unknown>) : null;
    const attachmentId = string(item.attachmentId || body?.attachmentId, 512);
    const filename = string(item.filename, 500);
    if (attachmentId && filename && messageId && !seen.has(`${messageId}:${attachmentId}`)) {
      seen.add(`${messageId}:${attachmentId}`);
      result.push({
        messageId,
        attachmentId,
        filename,
        size:
          typeof item.size === 'number'
            ? item.size
            : typeof body?.size === 'number'
              ? body.size
              : null,
      });
    }
    for (const child of Object.values(item)) walk(child, messageId, depth + 1);
  }
  walk(payload);
  return result.slice(0, 50);
}

export function draftIds(payload: MailPayload | undefined): string[] {
  const seen = new Set<string>();
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (item && typeof item === 'object') {
        const id = string(
          (item as Record<string, unknown>).draftId || (item as Record<string, unknown>).id,
          512,
        );
        if (id) seen.add(id);
      }
    }
  } else if (payload && typeof payload === 'object') {
    const value = payload as Record<string, unknown>;
    const drafts = Array.isArray(value.drafts) ? value.drafts : [];
    for (const item of drafts) {
      if (item && typeof item === 'object') {
        const id = string(
          (item as Record<string, unknown>).draftId || (item as Record<string, unknown>).id,
          512,
        );
        if (id) seen.add(id);
      }
    }
    const direct = string(value.draftId || (value.message ? value.id : ''), 512);
    if (direct) seen.add(direct);
  }
  return [...seen].slice(0, 50);
}

export function safeMailText(payload: MailPayload | undefined) {
  return JSON.stringify(payload ?? {}, null, 2).slice(0, 100_000);
}
