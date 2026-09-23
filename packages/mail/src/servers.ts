import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { MailAddress } from './parse';

export interface MailServerSettings {
  imapHost: string;
  imapPort: number;
  // true: TLS from the first byte (993/465). false: STARTTLS is required, so a
  // password never crosses an unencrypted connection.
  imapTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  username: string;
  password: string;
}

const TIMEOUT_MS = 20_000;

export function createImapClient(settings: MailServerSettings): ImapFlow {
  return new ImapFlow({
    host: settings.imapHost,
    port: settings.imapPort,
    secure: settings.imapTls,
    doSTARTTLS: settings.imapTls ? undefined : true,
    auth: { user: settings.username, pass: settings.password },
    logger: false,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    clientInfo: { name: 'Volition' },
  });
}

function smtpTransport(settings: MailServerSettings) {
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpTls,
    requireTLS: !settings.smtpTls,
    auth: { user: settings.username, pass: settings.password },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: 60_000,
  });
}

// A connection problem as the owner can act on it; the server's own words when it
// sent some, never the password or the stack.
export function connectionError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Connection failed';
  const value = error as {
    authenticationFailed?: boolean;
    responseText?: string;
    response?: string;
    code?: string;
    message?: string;
  };
  if (value.authenticationFailed) return 'Authentication failed';
  const text = value.responseText ?? value.response ?? value.message ?? value.code ?? '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 300) || 'Connection failed';
}

export async function testImapConnection(settings: MailServerSettings): Promise<string | null> {
  const client = createImapClient(settings);
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.logout();
    return null;
  } catch (error) {
    client.close();
    return connectionError(error);
  }
}

export async function testSmtpConnection(settings: MailServerSettings): Promise<string | null> {
  const transport = smtpTransport(settings);
  try {
    await transport.verify();
    return null;
  } catch (error) {
    return connectionError(error);
  } finally {
    transport.close();
  }
}

export async function sendRawMail(
  settings: MailServerSettings,
  envelope: { from: string; to: string[] },
  raw: Buffer,
): Promise<void> {
  const transport = smtpTransport(settings);
  try {
    await transport.sendMail({ envelope, raw });
  } finally {
    transport.close();
  }
}

export interface OutgoingMail {
  messageId: string;
  date: Date;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  html: string;
  text: string;
  inReplyTo: string | null;
  references: string[];
  attachments: { filename: string; contentType: string; content: Buffer }[];
}

// The MIME source of an outgoing mail. The copy for the Sent folder keeps the Bcc
// header so the owner sees who got a blind copy; the one handed to SMTP drops it.
export async function buildMime(mail: OutgoingMail, keepBcc: boolean): Promise<Buffer> {
  const node = new MailComposer({
    messageId: mail.messageId,
    date: mail.date,
    from: mail.from,
    to: mail.to,
    cc: mail.cc,
    bcc: mail.bcc,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    inReplyTo: mail.inReplyTo ?? undefined,
    references: mail.references.length > 0 ? mail.references : undefined,
    attachments: mail.attachments,
  }).compile();
  node.keepBcc = keepBcc;
  return node.build();
}

export type FolderRole = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'all';

const ROLES: Record<string, FolderRole> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Trash': 'trash',
  '\\Junk': 'junk',
  '\\Archive': 'archive',
  '\\All': 'all',
};

export function folderRole(path: string, specialUse: string | undefined): FolderRole | null {
  if (path.toUpperCase() === 'INBOX') return 'inbox';
  return specialUse ? (ROLES[specialUse] ?? null) : null;
}

// Gmail keeps every message of an account in "All Mail" and shows each label as a
// folder of its own; an archived message without a label exists only in All Mail. So
// All Mail is imported in full and a label folder costs one header fetch, because a
// message is stored once per account (by Message-ID) and only its folder locations
// are added. "Important" and "Starred" are views, not folders: the star is the
// \Flagged flag.
export function isSkippedFolder(
  folder: { flags: Set<string>; specialUse?: string },
  options: { syncTrash: boolean; syncSpam: boolean },
): boolean {
  if (folder.flags.has('\\Noselect') || folder.flags.has('\\NonExistent')) return true;
  if (folder.flags.has('\\Important') || folder.specialUse === '\\Flagged') return true;
  if (folder.specialUse === '\\Trash') return !options.syncTrash;
  if (folder.specialUse === '\\Junk') return !options.syncSpam;
  return false;
}

// Import order: the inbox first so the owner can work with it early, then what was
// sent, then All Mail, which holds every message of a Gmail account.
export function folderPriority(role: string | null): number {
  if (role === 'inbox') return 0;
  if (role === 'sent') return 1;
  if (role === 'all') return 2;
  return 3;
}

export function isGmailHost(host: string): boolean {
  return /(^|\.)(gmail|googlemail)\.com$/i.test(host.trim());
}
