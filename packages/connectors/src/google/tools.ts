import { calendar } from '@googleapis/calendar';
import { docs } from '@googleapis/docs';
import { drive } from '@googleapis/drive';
import { gmail, type gmail_v1 } from '@googleapis/gmail';
import { people } from '@googleapis/people';
import { sheets } from '@googleapis/sheets';
import { tasks } from '@googleapis/tasks';
import { Type as T, type Static, type TSchema } from '@sinclair/typebox';
import type { OAuth2Client } from 'google-auth-library';
import { buildMime } from '@repo/mail';
import { randomUUID } from 'node:crypto';
import type { ActionCategory, ConnectorTool } from '../sdk';
import type { GoogleServiceId } from './services';

// The agent tools of a Google account. Each runs on one of two engines: Google's own API
// clients with the token Helena holds ('helena'), or the gog CLI through Helena's broker
// for an account whose token lives in gog's keyring ('gog'). A tool without a gog form is
// not offered on a gog account. Every answer is cut to a size a model can read.

export interface GoogleToolContext {
  engine: 'helena' | 'gog';
  email: string;
  // The helena engine: a client that signs requests with the account's token.
  auth?: OAuth2Client;
  // The gog engine: runs one allowlisted gog command for the account.
  gog?: (command: string, args: string[], stdin?: string) => Promise<unknown>;
}

// Tests point the API clients at a local fake of Google.
let rootUrl: string | undefined;
export function setGoogleApiRootForTests(url: string | null): void {
  rootUrl = url ?? undefined;
}

const MAX_TEXT = 20_000;
const MAX_JSON = 60_000;

function clip(value: string | null | undefined, max = MAX_TEXT): string {
  if (!value) return '';
  return value.length > max
    ? `${value.slice(0, max)}\n[… ${value.length - max} more characters]`
    : value;
}

// An answer as the model gets it: kept whole when small, otherwise cut with a note.
export function bounded(value: unknown): unknown {
  const json = JSON.stringify(value ?? null);
  if (json.length <= MAX_JSON) return value;
  return { truncated: true, preview: json.slice(0, MAX_JSON) };
}

const account = T.String({
  description: 'The Google account to use, by its address (see list_connections).',
  format: 'email',
});

interface GoogleToolSpec<S extends TSchema> {
  name: string;
  service: GoogleServiceId;
  description: string;
  input: S;
  category: ActionCategory | ((input: Static<S>) => ActionCategory);
  summarize(input: Static<S>): string;
  helena(input: Static<S>, auth: OAuth2Client): Promise<unknown>;
  gog?: {
    command: string;
    args(input: Static<S>): string[];
    stdin?(input: Static<S>): Promise<string>;
  };
}

export type GoogleTool = ConnectorTool<GoogleToolContext, Record<string, unknown>> & {
  // The gog command the tool runs on a gog account; absent when it has none.
  gogCommand: string | null;
};

function tool<S extends TSchema>(spec: GoogleToolSpec<S>): GoogleTool {
  const schema = T.Object(
    { account, ...(spec.input as unknown as { properties: Record<string, TSchema> }).properties },
    {
      additionalProperties: false,
    },
  );
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: schema as unknown as Record<string, unknown>,
    service: spec.service,
    category: spec.category as GoogleTool['category'],
    summarize: (input) => spec.summarize(input as Static<S>),
    gogCommand: spec.gog?.command ?? null,
    async handler(input, ctx) {
      const typed = input as Static<S>;
      if (ctx.engine === 'helena') {
        if (!ctx.auth) throw new Error('The account is not signed in to Helena.');
        return bounded(await spec.helena(typed, ctx.auth));
      }
      if (!spec.gog || !ctx.gog) {
        throw new Error(`${spec.name} is not available for an account kept in gog.`);
      }
      const stdin = spec.gog.stdin ? await spec.gog.stdin(typed) : undefined;
      return bounded(await ctx.gog(spec.gog.command, spec.gog.args(typed), stdin));
    },
  };
}

// ── Gmail ───────────────────────────────────────────────────────────────────────────────

const gmailApi = (auth: OAuth2Client) => gmail({ version: 'v1', auth, rootUrl });

type GmailPart = gmail_v1.Schema$MessagePart;

function header(part: GmailPart | undefined, name: string): string {
  const found = part?.headers?.find((entry) => entry.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? '';
}

function decode(data: string | null | undefined): string {
  return data ? Buffer.from(data, 'base64url').toString('utf8') : '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function bodyText(part: GmailPart | undefined): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data);
  const parts = part.parts ?? [];
  const plain = parts.map(bodyText).find((text) => text);
  if (plain) return plain;
  if (part.mimeType === 'text/html' && part.body?.data) return stripHtml(decode(part.body.data));
  return '';
}

function attachments(
  part: GmailPart | undefined,
): { filename: string; mimeType: string; size: number }[] {
  if (!part) return [];
  const own =
    part.filename && part.body?.attachmentId
      ? [{ filename: part.filename, mimeType: part.mimeType ?? '', size: part.body.size ?? 0 }]
      : [];
  return [...own, ...(part.parts ?? []).flatMap(attachments)];
}

const recipients = T.Array(T.String({ format: 'email' }), { minItems: 1, maxItems: 50 });

const mailSend = T.Object({
  to: recipients,
  cc: T.Optional(T.Array(T.String({ format: 'email' }), { maxItems: 50 })),
  bcc: T.Optional(T.Array(T.String({ format: 'email' }), { maxItems: 50 })),
  subject: T.String({ maxLength: 500 }),
  body: T.String({ maxLength: 100_000, description: 'The text of the mail.' }),
  threadId: T.Optional(T.String({ description: 'Reply within this Gmail thread.' })),
  inReplyTo: T.Optional(
    T.String({ description: 'The Message-ID header of the mail this answers, for threading.' }),
  ),
});

async function mimeOf(input: Static<typeof mailSend> & { account: string }): Promise<Buffer> {
  const address = (value: string) => ({ name: '', address: value });
  return buildMime(
    {
      messageId: `<${randomUUID()}@helena>`,
      date: new Date(),
      from: address(input.account),
      to: input.to.map(address),
      cc: (input.cc ?? []).map(address),
      bcc: (input.bcc ?? []).map(address),
      subject: input.subject,
      html: '',
      text: input.body,
      inReplyTo: input.inReplyTo ?? null,
      references: input.inReplyTo ? [input.inReplyTo] : [],
      attachments: [],
    },
    // Gmail reads the recipients from the headers and drops the Bcc header on sending.
    true,
  );
}

const MAIL_TOOLS = [
  tool({
    name: 'google_mail_search',
    service: 'mail',
    category: 'read',
    description:
      'Search the Gmail account with Gmail search syntax (from:, to:, subject:, after:2026/01/31, has:attachment, label:, is:unread …). Returns threads with sender, subject, date and a snippet; read one with google_mail_read_thread.',
    input: T.Object({
      query: T.String({ maxLength: 500 }),
      max: T.Optional(T.Integer({ minimum: 1, maximum: 50, default: 10 })),
    }),
    summarize: (input) => `Search mail: ${input.query}`,
    async helena(input, auth) {
      const api = gmailApi(auth);
      const listed = await api.users.threads.list({
        userId: 'me',
        q: input.query,
        maxResults: input.max ?? 10,
      });
      const threads = [];
      for (const entry of listed.data.threads ?? []) {
        const thread = await api.users.threads.get({
          userId: 'me',
          id: entry.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });
        const last = thread.data.messages?.at(-1);
        threads.push({
          threadId: entry.id,
          messages: thread.data.messages?.length ?? 0,
          from: header(last?.payload, 'From'),
          subject: header(last?.payload, 'Subject'),
          date: header(last?.payload, 'Date'),
          snippet: entry.snippet ?? last?.snippet ?? '',
        });
      }
      return { threads };
    },
    gog: {
      command: 'gmail.search',
      args: (input) => ['gmail', 'search', input.query, `--max=${input.max ?? 10}`],
    },
  }),
  tool({
    name: 'google_mail_read_thread',
    service: 'mail',
    category: 'read',
    description:
      'Read a Gmail thread: every message with sender, recipients, date, text and attachment names.',
    input: T.Object({ threadId: T.String({ maxLength: 200 }) }),
    summarize: (input) => `Read mail thread ${input.threadId}`,
    async helena(input, auth) {
      const thread = await gmailApi(auth).users.threads.get({
        userId: 'me',
        id: input.threadId,
        format: 'full',
      });
      return {
        threadId: input.threadId,
        messages: (thread.data.messages ?? []).map((message) => ({
          id: message.id,
          messageId: header(message.payload, 'Message-ID'),
          from: header(message.payload, 'From'),
          to: header(message.payload, 'To'),
          cc: header(message.payload, 'Cc'),
          date: header(message.payload, 'Date'),
          subject: header(message.payload, 'Subject'),
          labels: message.labelIds ?? [],
          text: clip(bodyText(message.payload)),
          attachments: attachments(message.payload),
        })),
      };
    },
    gog: {
      command: 'gmail.thread.get',
      args: (input) => ['gmail', 'thread', 'get', input.threadId, '--sanitize-content'],
    },
  }),
  tool({
    name: 'google_mail_send',
    service: 'mail',
    category: 'send',
    description:
      'Send a mail from the Gmail account. Sending reaches people outside Helena, so it usually waits for the owner’s approval; the answer says so and gives the action id.',
    input: mailSend,
    summarize: (input) => `Send mail to ${input.to.join(', ')}: ${input.subject}`,
    async helena(input, auth) {
      const raw = await mimeOf(input as Static<typeof mailSend> & { account: string });
      const sent = await gmailApi(auth).users.messages.send({
        userId: 'me',
        requestBody: { raw: raw.toString('base64url'), threadId: input.threadId },
      });
      return { sent: true, id: sent.data.id, threadId: sent.data.threadId };
    },
    gog: {
      command: 'gmail.send',
      args: () => ['gmail', 'send', '--raw-file', '-'],
      stdin: async (input) =>
        (await mimeOf(input as Static<typeof mailSend> & { account: string })).toString('utf8'),
    },
  }),
  tool({
    name: 'google_mail_draft',
    service: 'mail',
    category: 'write',
    description: 'Save a draft in the Gmail account without sending it.',
    input: mailSend,
    summarize: (input) => `Draft mail to ${input.to.join(', ')}: ${input.subject}`,
    async helena(input, auth) {
      const raw = await mimeOf(input as Static<typeof mailSend> & { account: string });
      const draft = await gmailApi(auth).users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw: raw.toString('base64url'), threadId: input.threadId } },
      });
      return { draftId: draft.data.id };
    },
  }),
  tool({
    name: 'google_mail_label',
    service: 'mail',
    category: 'write',
    description:
      'Change the labels of a Gmail thread: archive it (remove INBOX), mark it read (remove UNREAD), star it (add STARRED) or file it under a label id.',
    input: T.Object({
      threadId: T.String({ maxLength: 200 }),
      add: T.Optional(T.Array(T.String({ maxLength: 200 }), { maxItems: 20 })),
      remove: T.Optional(T.Array(T.String({ maxLength: 200 }), { maxItems: 20 })),
    }),
    summarize: (input) =>
      `Relabel mail thread ${input.threadId}: +${(input.add ?? []).join(',')} -${(input.remove ?? []).join(',')}`,
    async helena(input, auth) {
      await gmailApi(auth).users.threads.modify({
        userId: 'me',
        id: input.threadId,
        requestBody: { addLabelIds: input.add ?? [], removeLabelIds: input.remove ?? [] },
      });
      return { changed: true };
    },
  }),
  tool({
    name: 'google_mail_trash',
    service: 'mail',
    category: 'delete',
    description: 'Move a Gmail message to the trash (Gmail empties it after 30 days).',
    input: T.Object({ messageId: T.String({ maxLength: 200 }) }),
    summarize: (input) => `Trash mail ${input.messageId}`,
    async helena(input, auth) {
      await gmailApi(auth).users.messages.trash({ userId: 'me', id: input.messageId });
      return { trashed: true };
    },
    gog: { command: 'gmail.trash', args: (input) => ['gmail', 'trash', input.messageId] },
  }),
];

// ── Calendar ────────────────────────────────────────────────────────────────────────────

const calendarApi = (auth: OAuth2Client) => calendar({ version: 'v3', auth, rootUrl });

const when = (what: string) =>
  T.String({ description: `${what}: an ISO date-time with offset, or a date for all-day events.` });

function eventTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? { date: value } : { dateTime: value };
}

const eventFields = {
  summary: T.Optional(T.String({ maxLength: 500 })),
  description: T.Optional(T.String({ maxLength: 8000 })),
  location: T.Optional(T.String({ maxLength: 500 })),
  start: T.Optional(when('Start')),
  end: T.Optional(when('End')),
  attendees: T.Optional(
    T.Array(T.String({ format: 'email' }), {
      maxItems: 50,
      description: 'Guests. Google sends them an invitation, which reaches people outside Helena.',
    }),
  ),
};

const invites = (input: { attendees?: string[] }): ActionCategory =>
  input.attendees && input.attendees.length > 0 ? 'send' : 'write';

function publicEvent(event: {
  id?: string | null;
  summary?: string | null;
  start?: { date?: string | null; dateTime?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null } | null;
  location?: string | null;
  status?: string | null;
  htmlLink?: string | null;
  attendees?: { email?: string | null; responseStatus?: string | null }[] | null;
  description?: string | null;
}) {
  return {
    id: event.id,
    summary: event.summary ?? '',
    start: event.start?.dateTime ?? event.start?.date ?? '',
    end: event.end?.dateTime ?? event.end?.date ?? '',
    location: event.location ?? '',
    status: event.status ?? '',
    attendees: (event.attendees ?? []).map((a) => `${a.email ?? ''} (${a.responseStatus ?? ''})`),
    description: clip(event.description, 2000),
    link: event.htmlLink ?? '',
  };
}

const CALENDAR_TOOLS = [
  tool({
    name: 'google_calendar_events',
    service: 'calendar',
    category: 'read',
    description:
      'List Google Calendar events between two times. Set account to the connected Google email address; omit calendarId for its primary calendar. Use calendarId only for a separate calendar ID within that account.',
    input: T.Object({
      calendarId: T.Optional(
        T.String({
          default: 'primary',
          maxLength: 300,
          description:
            'Calendar ID within the selected Google account. Omit for the primary calendar.',
        }),
      ),
      from: T.String({ description: 'ISO date-time the window starts.' }),
      to: T.String({ description: 'ISO date-time the window ends.' }),
      query: T.Optional(T.String({ maxLength: 200 })),
      max: T.Optional(T.Integer({ minimum: 1, maximum: 100, default: 25 })),
    }),
    summarize: (input) => `List events ${input.from} – ${input.to}`,
    async helena(input, auth) {
      const listed = await calendarApi(auth).events.list({
        calendarId: input.calendarId ?? 'primary',
        timeMin: input.from,
        timeMax: input.to,
        q: input.query,
        maxResults: input.max ?? 25,
        singleEvents: true,
        orderBy: 'startTime',
      });
      return { events: (listed.data.items ?? []).map(publicEvent) };
    },
    gog: {
      command: 'calendar.events',
      args: (input) => [
        'calendar',
        'events',
        input.calendarId ?? 'primary',
        `--from=${input.from}`,
        `--to=${input.to}`,
        `--max=${input.max ?? 25}`,
        ...(input.query ? [`--query=${input.query}`] : []),
      ],
    },
  }),
  tool({
    name: 'google_calendar_create_event',
    service: 'calendar',
    category: invites,
    description: 'Create a calendar event. With guests, Google invites them (needs approval).',
    input: T.Object({
      calendarId: T.Optional(T.String({ default: 'primary', maxLength: 300 })),
      ...eventFields,
      summary: T.String({ maxLength: 500 }),
      start: when('Start'),
      end: when('End'),
    }),
    summarize: (input) =>
      `Create event "${input.summary}" ${input.start}${input.attendees?.length ? ` with ${input.attendees.join(', ')}` : ''}`,
    async helena(input, auth) {
      const created = await calendarApi(auth).events.insert({
        calendarId: input.calendarId ?? 'primary',
        sendUpdates: input.attendees?.length ? 'all' : 'none',
        requestBody: {
          summary: input.summary,
          description: input.description,
          location: input.location,
          start: eventTime(input.start),
          end: eventTime(input.end),
          attendees: input.attendees?.map((email) => ({ email })),
        },
      });
      return publicEvent(created.data);
    },
  }),
  tool({
    name: 'google_calendar_update_event',
    service: 'calendar',
    category: invites,
    description: 'Change a calendar event. With guests, Google tells them (needs approval).',
    input: T.Object({
      calendarId: T.Optional(T.String({ default: 'primary', maxLength: 300 })),
      eventId: T.String({ maxLength: 300 }),
      ...eventFields,
    }),
    summarize: (input) => `Change event ${input.eventId}`,
    async helena(input, auth) {
      const updated = await calendarApi(auth).events.patch({
        calendarId: input.calendarId ?? 'primary',
        eventId: input.eventId,
        sendUpdates: input.attendees?.length ? 'all' : 'none',
        requestBody: {
          ...(input.summary !== undefined && { summary: input.summary }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.location !== undefined && { location: input.location }),
          ...(input.start !== undefined && { start: eventTime(input.start) }),
          ...(input.end !== undefined && { end: eventTime(input.end) }),
          ...(input.attendees !== undefined && {
            attendees: input.attendees.map((email) => ({ email })),
          }),
        },
      });
      return publicEvent(updated.data);
    },
  }),
  tool({
    name: 'google_calendar_delete_event',
    service: 'calendar',
    category: 'delete',
    description: 'Delete a calendar event.',
    input: T.Object({
      calendarId: T.Optional(T.String({ default: 'primary', maxLength: 300 })),
      eventId: T.String({ maxLength: 300 }),
    }),
    summarize: (input) => `Delete event ${input.eventId}`,
    async helena(input, auth) {
      await calendarApi(auth).events.delete({
        calendarId: input.calendarId ?? 'primary',
        eventId: input.eventId,
        sendUpdates: 'none',
      });
      return { deleted: true };
    },
  }),
];

// ── Drive, Docs, Sheets ────────────────────────────────────────────────────────────────

const driveApi = (auth: OAuth2Client) => drive({ version: 'v3', auth, rootUrl });
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,size,webViewLink,owners(emailAddress),parents';

// A plain text is searched in names and contents; Drive query syntax passes as it is.
function driveQuery(query: string): string {
  const drivesyntax =
    /\b(name|fullText|mimeType|modifiedTime|parents|trashed|owners)\b\s*(=|!=|contains|in|<|>)/.test(
      query,
    );
  if (drivesyntax) return query;
  const escaped = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `(name contains '${escaped}' or fullText contains '${escaped}') and trashed = false`;
}

const EXPORTS: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

const DRIVE_TOOLS = [
  tool({
    name: 'google_drive_search',
    service: 'drive',
    category: 'read',
    description:
      "Find files in Google Drive by name or content (plain text), or with Drive query syntax (e.g. mimeType = 'application/pdf').",
    input: T.Object({
      query: T.String({ maxLength: 500 }),
      max: T.Optional(T.Integer({ minimum: 1, maximum: 100, default: 20 })),
    }),
    summarize: (input) => `Search Drive: ${input.query}`,
    async helena(input, auth) {
      const listed = await driveApi(auth).files.list({
        q: driveQuery(input.query),
        pageSize: input.max ?? 20,
        fields: `files(${FILE_FIELDS})`,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      return { files: listed.data.files ?? [] };
    },
  }),
  tool({
    name: 'google_drive_read',
    service: 'drive',
    category: 'read',
    description:
      'Read a Drive file: its details, and its text for Google Docs, Sheets (as CSV), Slides and plain text files.',
    input: T.Object({ fileId: T.String({ maxLength: 300 }) }),
    summarize: (input) => `Read Drive file ${input.fileId}`,
    async helena(input, auth) {
      const api = driveApi(auth);
      const meta = await api.files.get({
        fileId: input.fileId,
        fields: FILE_FIELDS,
        supportsAllDrives: true,
      });
      const mime = meta.data.mimeType ?? '';
      let text = '';
      if (EXPORTS[mime]) {
        const exported = await api.files.export(
          { fileId: input.fileId, mimeType: EXPORTS[mime] },
          { responseType: 'text' },
        );
        text = String(exported.data ?? '');
      } else if (mime.startsWith('text/') || mime === 'application/json') {
        const content = await api.files.get(
          { fileId: input.fileId, alt: 'media', supportsAllDrives: true },
          { responseType: 'text' },
        );
        text = String(content.data ?? '');
      }
      return { file: meta.data, text: clip(text) };
    },
  }),
  tool({
    name: 'google_drive_upload',
    service: 'drive',
    category: 'write',
    description: 'Create a text file in Google Drive (optionally in a folder).',
    input: T.Object({
      name: T.String({ maxLength: 300 }),
      content: T.String({ maxLength: 1_000_000 }),
      mimeType: T.Optional(T.String({ default: 'text/plain', maxLength: 200 })),
      folderId: T.Optional(T.String({ maxLength: 300 })),
    }),
    summarize: (input) => `Create Drive file ${input.name}`,
    async helena(input, auth) {
      const created = await driveApi(auth).files.create({
        requestBody: { name: input.name, parents: input.folderId ? [input.folderId] : undefined },
        media: { mimeType: input.mimeType ?? 'text/plain', body: input.content },
        fields: FILE_FIELDS,
        supportsAllDrives: true,
      });
      return { file: created.data };
    },
  }),
  tool({
    name: 'google_drive_share',
    service: 'drive',
    category: 'publish',
    description:
      'Share a Drive file with a person (reader, commenter or writer). The person gets access outside Helena, so this needs approval.',
    input: T.Object({
      fileId: T.String({ maxLength: 300 }),
      email: T.String({ format: 'email' }),
      role: T.Union([T.Literal('reader'), T.Literal('commenter'), T.Literal('writer')]),
      notify: T.Optional(T.Boolean({ default: true })),
    }),
    summarize: (input) => `Share Drive file ${input.fileId} with ${input.email} as ${input.role}`,
    async helena(input, auth) {
      const permission = await driveApi(auth).permissions.create({
        fileId: input.fileId,
        sendNotificationEmail: input.notify ?? true,
        supportsAllDrives: true,
        requestBody: { type: 'user', role: input.role, emailAddress: input.email },
      });
      return { permissionId: permission.data.id };
    },
  }),
  tool({
    name: 'google_drive_delete',
    service: 'drive',
    category: 'delete',
    description: 'Move a Drive file to the trash.',
    input: T.Object({ fileId: T.String({ maxLength: 300 }) }),
    summarize: (input) => `Trash Drive file ${input.fileId}`,
    async helena(input, auth) {
      await driveApi(auth).files.update({
        fileId: input.fileId,
        supportsAllDrives: true,
        requestBody: { trashed: true },
      });
      return { trashed: true };
    },
  }),
];

const docsApi = (auth: OAuth2Client) => docs({ version: 'v1', auth, rootUrl });

interface DocElement {
  paragraph?: { elements?: { textRun?: { content?: string | null } }[] | null } | null;
  table?: {
    tableRows?: { tableCells?: { content?: DocElement[] | null }[] | null }[] | null;
  } | null;
}

function docText(content: DocElement[] | null | undefined): string {
  return (content ?? [])
    .map((element) => {
      if (element.paragraph) {
        return (element.paragraph.elements ?? []).map((run) => run.textRun?.content ?? '').join('');
      }
      if (element.table) {
        return (element.table.tableRows ?? [])
          .map((row) =>
            (row.tableCells ?? []).map((cell) => docText(cell.content).trim()).join(' | '),
          )
          .join('\n');
      }
      return '';
    })
    .join('');
}

const DOCS_TOOLS = [
  tool({
    name: 'google_docs_read',
    service: 'docs',
    category: 'read',
    description: 'Read the text of a Google Doc.',
    input: T.Object({ documentId: T.String({ maxLength: 300 }) }),
    summarize: (input) => `Read Doc ${input.documentId}`,
    async helena(input, auth) {
      const doc = await docsApi(auth).documents.get({ documentId: input.documentId });
      return { title: doc.data.title, text: clip(docText(doc.data.body?.content as DocElement[])) };
    },
  }),
  tool({
    name: 'google_docs_create',
    service: 'docs',
    category: 'write',
    description: 'Create a Google Doc with a title and optional text.',
    input: T.Object({
      title: T.String({ maxLength: 300 }),
      text: T.Optional(T.String({ maxLength: 500_000 })),
    }),
    summarize: (input) => `Create Doc "${input.title}"`,
    async helena(input, auth) {
      const api = docsApi(auth);
      const doc = await api.documents.create({ requestBody: { title: input.title } });
      if (input.text) {
        await api.documents.batchUpdate({
          documentId: doc.data.documentId!,
          requestBody: { requests: [{ insertText: { location: { index: 1 }, text: input.text } }] },
        });
      }
      return { documentId: doc.data.documentId, title: doc.data.title };
    },
  }),
  tool({
    name: 'google_docs_append',
    service: 'docs',
    category: 'write',
    description: 'Add text at the end of a Google Doc.',
    input: T.Object({
      documentId: T.String({ maxLength: 300 }),
      text: T.String({ maxLength: 500_000 }),
    }),
    summarize: (input) => `Append to Doc ${input.documentId}`,
    async helena(input, auth) {
      await docsApi(auth).documents.batchUpdate({
        documentId: input.documentId,
        requestBody: {
          requests: [{ insertText: { endOfSegmentLocation: {}, text: input.text } }],
        },
      });
      return { appended: true };
    },
  }),
];

const sheetsApi = (auth: OAuth2Client) => sheets({ version: 'v4', auth, rootUrl });
const cells = T.Array(T.Array(T.Union([T.String(), T.Number(), T.Boolean()]), { maxItems: 200 }), {
  maxItems: 5000,
});

const SHEETS_TOOLS = [
  tool({
    name: 'google_sheets_read',
    service: 'sheets',
    category: 'read',
    description: 'Read a range of a Google Sheet (A1 notation, e.g. "Sheet1!A1:D50").',
    input: T.Object({
      spreadsheetId: T.String({ maxLength: 300 }),
      range: T.String({ maxLength: 200 }),
    }),
    summarize: (input) => `Read Sheet ${input.spreadsheetId} ${input.range}`,
    async helena(input, auth) {
      const values = await sheetsApi(auth).spreadsheets.values.get({
        spreadsheetId: input.spreadsheetId,
        range: input.range,
      });
      return { range: values.data.range, values: values.data.values ?? [] };
    },
  }),
  tool({
    name: 'google_sheets_update',
    service: 'sheets',
    category: 'write',
    description: 'Overwrite a range of a Google Sheet with rows of values.',
    input: T.Object({
      spreadsheetId: T.String({ maxLength: 300 }),
      range: T.String({ maxLength: 200 }),
      values: cells,
    }),
    summarize: (input) => `Write Sheet ${input.spreadsheetId} ${input.range}`,
    async helena(input, auth) {
      const updated = await sheetsApi(auth).spreadsheets.values.update({
        spreadsheetId: input.spreadsheetId,
        range: input.range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: input.values },
      });
      return { updatedCells: updated.data.updatedCells ?? 0 };
    },
  }),
  tool({
    name: 'google_sheets_append',
    service: 'sheets',
    category: 'write',
    description: 'Append rows below the table in a range of a Google Sheet.',
    input: T.Object({
      spreadsheetId: T.String({ maxLength: 300 }),
      range: T.String({ maxLength: 200 }),
      values: cells,
    }),
    summarize: (input) => `Append ${input.values.length} rows to Sheet ${input.spreadsheetId}`,
    async helena(input, auth) {
      const appended = await sheetsApi(auth).spreadsheets.values.append({
        spreadsheetId: input.spreadsheetId,
        range: input.range,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: input.values },
      });
      return { updatedRange: appended.data.updates?.updatedRange ?? null };
    },
  }),
];

// ── Contacts, Tasks ─────────────────────────────────────────────────────────────────────

const peopleApi = (auth: OAuth2Client) => people({ version: 'v1', auth, rootUrl });
const PERSON_FIELDS = 'names,emailAddresses,phoneNumbers,organizations';

function publicPerson(person: {
  resourceName?: string | null;
  names?: { displayName?: string | null }[] | null;
  emailAddresses?: { value?: string | null }[] | null;
  phoneNumbers?: { value?: string | null }[] | null;
  organizations?: { name?: string | null }[] | null;
}) {
  return {
    resourceName: person.resourceName,
    name: person.names?.[0]?.displayName ?? '',
    emails: (person.emailAddresses ?? []).map((entry) => entry.value ?? ''),
    phones: (person.phoneNumbers ?? []).map((entry) => entry.value ?? ''),
    organization: person.organizations?.[0]?.name ?? '',
  };
}

const CONTACT_TOOLS = [
  tool({
    name: 'google_contacts_search',
    service: 'contacts',
    category: 'read',
    description: 'Search the Google contacts by name, address or phone number.',
    input: T.Object({
      query: T.String({ maxLength: 200 }),
      max: T.Optional(T.Integer({ minimum: 1, maximum: 30, default: 10 })),
    }),
    summarize: (input) => `Search contacts: ${input.query}`,
    async helena(input, auth) {
      const found = await peopleApi(auth).people.searchContacts({
        query: input.query,
        pageSize: input.max ?? 10,
        readMask: PERSON_FIELDS,
      });
      return {
        contacts: (found.data.results ?? []).map((result) => publicPerson(result.person ?? {})),
      };
    },
    gog: {
      command: 'contacts.search',
      args: (input) => ['contacts', 'search', input.query, `--max=${input.max ?? 10}`],
    },
  }),
  tool({
    name: 'google_contacts_create',
    service: 'contacts',
    category: 'write',
    description: 'Add a Google contact.',
    input: T.Object({
      name: T.String({ maxLength: 200 }),
      email: T.Optional(T.String({ format: 'email' })),
      phone: T.Optional(T.String({ maxLength: 50 })),
      organization: T.Optional(T.String({ maxLength: 200 })),
    }),
    summarize: (input) => `Add contact ${input.name}`,
    async helena(input, auth) {
      const created = await peopleApi(auth).people.createContact({
        personFields: PERSON_FIELDS,
        requestBody: {
          names: [{ unstructuredName: input.name }],
          emailAddresses: input.email ? [{ value: input.email }] : undefined,
          phoneNumbers: input.phone ? [{ value: input.phone }] : undefined,
          organizations: input.organization ? [{ name: input.organization }] : undefined,
        },
      });
      return publicPerson(created.data);
    },
  }),
];

const tasksApi = (auth: OAuth2Client) => tasks({ version: 'v1', auth, rootUrl });
const taskList = T.Optional(
  T.String({
    default: '@default',
    maxLength: 300,
    description: 'Task list id; @default is the main list.',
  }),
);

function publicTask(task: {
  id?: string | null;
  title?: string | null;
  notes?: string | null;
  due?: string | null;
  status?: string | null;
  completed?: string | null;
}) {
  return {
    id: task.id,
    title: task.title ?? '',
    notes: clip(task.notes, 2000),
    due: task.due ?? null,
    status: task.status ?? '',
    completed: task.completed ?? null,
  };
}

const TASK_TOOLS = [
  tool({
    name: 'google_tasks_list',
    service: 'tasks',
    category: 'read',
    description: 'List the tasks of a Google Tasks list.',
    input: T.Object({
      tasklistId: taskList,
      showCompleted: T.Optional(T.Boolean({ default: false })),
    }),
    summarize: () => 'List Google tasks',
    async helena(input, auth) {
      const listed = await tasksApi(auth).tasks.list({
        tasklist: input.tasklistId ?? '@default',
        showCompleted: input.showCompleted ?? false,
        maxResults: 100,
      });
      return { tasks: (listed.data.items ?? []).map(publicTask) };
    },
  }),
  tool({
    name: 'google_tasks_create',
    service: 'tasks',
    category: 'write',
    description: 'Add a Google task.',
    input: T.Object({
      tasklistId: taskList,
      title: T.String({ maxLength: 500 }),
      notes: T.Optional(T.String({ maxLength: 8000 })),
      due: T.Optional(T.String({ description: 'Due date, ISO (the time is ignored by Google).' })),
    }),
    summarize: (input) => `Add Google task "${input.title}"`,
    async helena(input, auth) {
      const created = await tasksApi(auth).tasks.insert({
        tasklist: input.tasklistId ?? '@default',
        requestBody: { title: input.title, notes: input.notes, due: input.due },
      });
      return publicTask(created.data);
    },
  }),
  tool({
    name: 'google_tasks_update',
    service: 'tasks',
    category: 'write',
    description: 'Change or complete a Google task.',
    input: T.Object({
      tasklistId: taskList,
      taskId: T.String({ maxLength: 300 }),
      title: T.Optional(T.String({ maxLength: 500 })),
      notes: T.Optional(T.String({ maxLength: 8000 })),
      due: T.Optional(T.String()),
      status: T.Optional(T.Union([T.Literal('needsAction'), T.Literal('completed')])),
    }),
    summarize: (input) => `Change Google task ${input.taskId}`,
    async helena(input, auth) {
      const updated = await tasksApi(auth).tasks.patch({
        tasklist: input.tasklistId ?? '@default',
        task: input.taskId,
        requestBody: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.notes !== undefined && { notes: input.notes }),
          ...(input.due !== undefined && { due: input.due }),
          ...(input.status !== undefined && { status: input.status }),
        },
      });
      return publicTask(updated.data);
    },
  }),
  tool({
    name: 'google_tasks_delete',
    service: 'tasks',
    category: 'delete',
    description: 'Delete a Google task.',
    input: T.Object({ tasklistId: taskList, taskId: T.String({ maxLength: 300 }) }),
    summarize: (input) => `Delete Google task ${input.taskId}`,
    async helena(input, auth) {
      await tasksApi(auth).tasks.delete({
        tasklist: input.tasklistId ?? '@default',
        task: input.taskId,
      });
      return { deleted: true };
    },
  }),
];

export const GOOGLE_TOOLS: GoogleTool[] = [
  ...MAIL_TOOLS,
  ...CALENDAR_TOOLS,
  ...DRIVE_TOOLS,
  ...DOCS_TOOLS,
  ...SHEETS_TOOLS,
  ...CONTACT_TOOLS,
  ...TASK_TOOLS,
];

// The gog commands the broker may run for Helena, from the tools above.
export const GOG_TOOL_COMMANDS = GOOGLE_TOOLS.flatMap((entry) =>
  entry.gogCommand ? [entry.gogCommand] : [],
);
