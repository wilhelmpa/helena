import { EventEmitter } from 'node:events';
import type { MailServerSettings } from '@repo/mail';
import type { ImapClient, MailTransport } from '../../mail/transport';

// An in-memory IMAP server with the part of ImapFlow's API the importer uses, and an
// SMTP server that records what it was given.

interface StoredMessage {
  uid: number;
  flags: Set<string>;
  raw: Buffer;
  internalDate: Date;
  modseq: bigint;
  // What Gmail reports as X-GM-THRID.
  threadId?: string;
}

class FakeMailbox {
  uidNext = 1;
  modseq = 1n;
  messages: StoredMessage[] = [];
  constructor(
    readonly path: string,
    readonly specialUse: string | undefined,
    readonly flags: Set<string>,
    public uidValidity: bigint,
  ) {}
}

function messageIdOf(raw: Buffer): string | undefined {
  return /^Message-ID:\s*(<[^>]+>)/im.exec(raw.toString('utf8'))?.[1];
}

function parseRange(range: string, box: FakeMailbox): number[] {
  const uids = box.messages.map((message) => message.uid);
  const last = uids.at(-1) ?? 0;
  return range.split(',').flatMap((part) => {
    const [from, to] = part.split(':');
    if (to === undefined) return uids.includes(Number(from)) ? [Number(from)] : [];
    const start = Number(from);
    const end = to === '*' ? Math.max(last, start) : Number(to);
    const hits = uids.filter((uid) => uid >= Math.min(start, end) && uid <= Math.max(start, end));
    return hits.length === 0 && to === '*' && last > 0 ? [last] : hits;
  });
}

export class FakeImapServer {
  mailboxes = new Map<string, FakeMailbox>();
  sourceFetches = 0;
  failSourceFetchAt: number | null = null;
  condstore = false;
  clients: FakeImapClient[] = [];

  addMailbox(path: string, specialUse?: string, flags: string[] = []): FakeMailbox {
    const box = new FakeMailbox(path, specialUse, new Set(flags), 1n);
    this.mailboxes.set(path, box);
    return box;
  }

  add(
    path: string,
    raw: Buffer | string,
    flags: string[] = [],
    internalDate = new Date('2026-03-01T12:00:00Z'),
    threadId?: string,
  ): number {
    const box = this.mailboxes.get(path)!;
    const uid = box.uidNext++;
    box.modseq += 1n;
    box.messages.push({
      uid,
      flags: new Set(flags),
      raw: Buffer.isBuffer(raw) ? raw : Buffer.from(raw),
      internalDate,
      modseq: box.modseq,
      threadId,
    });
    for (const client of this.clients) {
      if (client.selected === path) client.emit('exists', { path, count: box.messages.length });
    }
    return uid;
  }

  remove(path: string, uid: number): void {
    const box = this.mailboxes.get(path)!;
    box.messages = box.messages.filter((message) => message.uid !== uid);
    box.modseq += 1n;
  }

  setFlags(path: string, uid: number, flags: string[]): void {
    const box = this.mailboxes.get(path)!;
    const message = box.messages.find((item) => item.uid === uid)!;
    box.modseq += 1n;
    message.flags = new Set(flags);
    message.modseq = box.modseq;
  }

  flagsOf(path: string, messageId: string): string[] {
    const message = this.mailboxes
      .get(path)!
      .messages.find((item) => messageIdOf(item.raw) === messageId);
    return message ? [...message.flags].sort() : [];
  }

  messageIdsIn(path: string): string[] {
    return this.mailboxes.get(path)!.messages.map((message) => messageIdOf(message.raw) ?? '');
  }
}

export class FakeImapClient extends EventEmitter {
  usable = false;
  enabled = new Set<string>();
  mailbox: Record<string, unknown> | false = false;
  selected: string | null = null;

  constructor(private readonly server: FakeImapServer) {
    super();
    server.clients.push(this);
    if (server.condstore) this.enabled.add('CONDSTORE');
  }

  private box(path: string): FakeMailbox {
    const box = this.server.mailboxes.get(path);
    if (!box)
      throw Object.assign(new Error(`Mailbox ${path} does not exist`), {
        responseText: 'NONEXISTENT',
      });
    return box;
  }

  async connect() {
    this.usable = true;
  }

  async logout() {
    this.close();
  }

  close() {
    if (!this.usable) return;
    this.usable = false;
    this.server.clients = this.server.clients.filter((client) => client !== this);
    this.emit('close');
  }

  async list() {
    return [...this.server.mailboxes.values()].map((box) => ({
      path: box.path,
      pathAsListed: box.path,
      name: box.path.split('/').at(-1)!,
      delimiter: '/',
      parent: [],
      parentPath: '',
      flags: box.flags,
      specialUse: box.specialUse,
      listed: true,
      subscribed: true,
    }));
  }

  async mailboxOpen(path: string) {
    const box = this.box(path);
    this.selected = path;
    this.mailbox = {
      path,
      uidValidity: box.uidValidity,
      uidNext: box.uidNext,
      exists: box.messages.length,
      highestModseq: this.server.condstore ? box.modseq : undefined,
    };
    return this.mailbox;
  }

  async getMailboxLock(path: string) {
    await this.mailboxOpen(path);
    return { path, release() {} };
  }

  async mailboxCreate(path: string) {
    if (!this.server.mailboxes.has(path)) this.server.addMailbox(path);
    return { path, created: true };
  }

  private current(): FakeMailbox {
    if (!this.selected) throw new Error('No mailbox selected');
    return this.box(this.selected);
  }

  searches: Record<string, unknown>[] = [];

  // SINCE compares the internal date by day, as IMAP does.
  async search(query: {
    all?: boolean;
    uid?: string;
    since?: Date;
    before?: Date;
    or?: { subject?: string; body?: string }[];
  }) {
    this.searches.push(query);
    const box = this.current();
    if (query.uid) return parseRange(query.uid, box);
    return box.messages
      .filter((message) => {
        const subject = /^Subject:\s*(.*)$/im.exec(message.raw.toString('utf8'))?.[1] ?? '';
        return (
          (!query.since || message.internalDate >= query.since) &&
          (!query.before || message.internalDate < query.before) &&
          (!query.or ||
            query.or.some((term) =>
              term.subject
                ? subject.toLowerCase().includes(term.subject.toLowerCase())
                : message.raw
                    .toString('utf8')
                    .toLowerCase()
                    .includes((term.body ?? '').toLowerCase()),
            ))
        );
      })
      .map((message) => message.uid);
  }

  async fetchAll(
    range: string,
    query: { source?: boolean; envelope?: boolean; threadId?: boolean },
    options: { changedSince?: bigint } = {},
  ) {
    const box = this.current();
    const uids = new Set(parseRange(range, box));
    const messages = box.messages.filter(
      (message) =>
        uids.has(message.uid) &&
        (options.changedSince === undefined || message.modseq > options.changedSince),
    );
    return messages.map((message) => {
      if (query.source) {
        this.server.sourceFetches += 1;
        if (this.server.failSourceFetchAt === this.server.sourceFetches) {
          this.usable = false;
          throw Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' });
        }
      }
      return {
        seq: 0,
        uid: message.uid,
        flags: new Set(message.flags),
        size: message.raw.length,
        internalDate: message.internalDate,
        threadId: query.threadId ? message.threadId : undefined,
        envelope: query.envelope ? { messageId: messageIdOf(message.raw) } : undefined,
        source: query.source ? message.raw : undefined,
      };
    });
  }

  async messageFlagsAdd(range: string, flags: string[]) {
    const box = this.current();
    for (const uid of parseRange(range, box)) {
      const message = box.messages.find((item) => item.uid === uid)!;
      this.server.setFlags(box.path, uid, [...message.flags, ...flags]);
    }
    return true;
  }

  async messageFlagsRemove(range: string, flags: string[]) {
    const box = this.current();
    for (const uid of parseRange(range, box)) {
      const message = box.messages.find((item) => item.uid === uid)!;
      this.server.setFlags(
        box.path,
        uid,
        [...message.flags].filter((flag) => !flags.includes(flag)),
      );
    }
    return true;
  }

  async messageMove(range: string, destination: string) {
    const box = this.current();
    for (const uid of parseRange(range, box)) {
      const message = box.messages.find((item) => item.uid === uid)!;
      const target = this.box(destination);
      const known = target.messages.some(
        (item) => messageIdOf(item.raw) === messageIdOf(message.raw),
      );
      if (!known) this.server.add(destination, message.raw, [...message.flags]);
      this.server.remove(box.path, uid);
    }
    return { path: box.path, destination };
  }

  async append(path: string, content: Buffer, flags: string[] = []) {
    const uid = this.server.add(path, content, flags);
    return { destination: path, uid, uidValidity: this.box(path).uidValidity };
  }
}

export interface SentMail {
  settings: MailServerSettings;
  envelope: { from: string; to: string[] };
  raw: string;
}

export function fakeTransport(server: FakeImapServer, sent: SentMail[]): MailTransport {
  return {
    imap: () => new FakeImapClient(server) as unknown as ImapClient,
    send: async (settings, envelope, raw) => {
      sent.push({ settings, envelope, raw: raw.toString('utf8') });
    },
  };
}

export function eml(input: {
  id: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  inReplyTo?: string;
  body?: string;
  attachment?: { name: string; content: string };
}): string {
  const headers = [
    `From: ${input.from ?? 'Anna <anna@verve.example>'}`,
    `To: ${input.to ?? 'me@home.example'}`,
    `Subject: ${input.subject ?? 'Hello'}`,
    `Date: ${input.date ?? 'Tue, 10 Mar 2026 12:00:00 +0000'}`,
    `Message-ID: ${input.id}`,
    ...(input.inReplyTo
      ? [`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`]
      : []),
    'MIME-Version: 1.0',
  ];
  if (!input.attachment) {
    return [
      ...headers,
      'Content-Type: text/plain; charset=utf-8',
      '',
      input.body ?? 'Body',
      '',
    ].join('\r\n');
  }
  return [
    ...headers,
    'Content-Type: multipart/mixed; boundary="b"',
    '',
    '--b',
    'Content-Type: text/plain; charset=utf-8',
    '',
    input.body ?? 'Body',
    '--b',
    `Content-Type: application/pdf; name="${input.attachment.name}"`,
    `Content-Disposition: attachment; filename="${input.attachment.name}"`,
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(input.attachment.content).toString('base64'),
    '--b--',
    '',
  ].join('\r\n');
}
