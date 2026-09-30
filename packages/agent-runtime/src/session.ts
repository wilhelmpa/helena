import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';
import type { HelenaApi, StoredSession } from './helena-client';

// Where a session's messages are kept, so a command started again with `--resume <id>` (the
// runner claims the run again after a crash or a restart) picks the conversation up where the
// last saved step left it. In production that is Helena (Postgres, helena_agent_session*);
// the evals and the tests keep it in files or in memory.

export interface SessionMeta {
  kind: 'run' | 'chat' | 'reflection';
  model: string;
  runId: number | null;
  threadId: string | null;
}

export interface SessionItem {
  seq: number;
  step: number;
  message: ModelMessage;
}

export interface SessionStore {
  create(meta: SessionMeta): Promise<string>;
  load(id: string): Promise<StoredSession | null>;
  // Idempotent per seq: an item already there is left as it is.
  append(id: string, items: SessionItem[]): Promise<void>;
  compact(id: string, summary: string, compactedThrough: number): Promise<void>;
}

// The readable text of a message, for the knowledge index (session search).
export function messageText(message: ModelMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'tool-call')
        return `[${part.toolName}] ${JSON.stringify(part.input).slice(0, 500)}`;
      if (part.type === 'tool-result') {
        const output = part.output;
        const value =
          output.type === 'text' || output.type === 'error-text'
            ? output.value
            : 'value' in output
              ? JSON.stringify(output.value)
              : '';
        return `[${part.toolName} →] ${value.slice(0, 1000)}`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export class HelenaSessionStore implements SessionStore {
  constructor(private readonly api: HelenaApi) {}

  create(meta: SessionMeta): Promise<string> {
    return this.api.createSession(meta);
  }

  load(id: string): Promise<StoredSession | null> {
    return this.api.loadSession(id);
  }

  append(id: string, items: SessionItem[]): Promise<void> {
    return this.api.appendItems(
      id,
      items.map((item) => ({ ...item, text: messageText(item.message).slice(0, 20_000) })),
    );
  }

  compact(id: string, summary: string, compactedThrough: number): Promise<void> {
    return this.api.compact(id, summary, compactedThrough);
  }
}

export class MemorySessionStore implements SessionStore {
  readonly sessions = new Map<string, StoredSession>();

  async create(): Promise<string> {
    const id = randomUUID();
    this.sessions.set(id, { id, summary: null, compactedThrough: 0, items: [] });
    return id;
  }

  async load(id: string): Promise<StoredSession | null> {
    const session = this.sessions.get(id);
    return session ? structuredClone(session) : null;
  }

  async append(id: string, items: SessionItem[]): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) throw new Error('session not found');
    for (const item of items) {
      if (session.items.some((existing) => existing.seq === item.seq)) continue;
      session.items.push(structuredClone(item));
    }
    session.items.sort((a, b) => a.seq - b.seq);
  }

  async compact(id: string, summary: string, compactedThrough: number): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) throw new Error('session not found');
    if (
      session.compactedThrough > compactedThrough ||
      (session.compactedThrough === compactedThrough && session.summary !== summary)
    )
      throw new Error('session compaction changed; reload the session');
    if (session.compactedThrough === compactedThrough) return;
    session.summary = summary;
    session.compactedThrough = compactedThrough;
  }
}

// One JSON file per session, written atomically; for the evals and an operator without Helena.
export class FileSessionStore implements SessionStore {
  constructor(private readonly dir: string) {}

  private path(id: string): string {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) throw new Error('invalid session id');
    return join(this.dir, `${id}.json`);
  }

  private async save(session: StoredSession): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const path = this.path(session.id);
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(session), { mode: 0o600 });
    await rename(temp, path);
  }

  async create(): Promise<string> {
    const id = randomUUID();
    await this.save({ id, summary: null, compactedThrough: 0, items: [] });
    return id;
  }

  async load(id: string): Promise<StoredSession | null> {
    try {
      return JSON.parse(await readFile(this.path(id), 'utf8')) as StoredSession;
    } catch {
      return null;
    }
  }

  async append(id: string, items: SessionItem[]): Promise<void> {
    const session = await this.load(id);
    if (!session) throw new Error('session not found');
    for (const item of items) {
      if (!session.items.some((existing) => existing.seq === item.seq)) session.items.push(item);
    }
    session.items.sort((a, b) => a.seq - b.seq);
    await this.save(session);
  }

  async compact(id: string, summary: string, compactedThrough: number): Promise<void> {
    const session = await this.load(id);
    if (!session) throw new Error('session not found');
    if (
      session.compactedThrough > compactedThrough ||
      (session.compactedThrough === compactedThrough && session.summary !== summary)
    )
      throw new Error('session compaction changed; reload the session');
    if (session.compactedThrough === compactedThrough) return;
    await this.save({ ...session, summary, compactedThrough });
  }
}
