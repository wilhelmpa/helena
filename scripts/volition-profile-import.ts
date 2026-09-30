import { Database } from 'bun:sqlite';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runVolitionScript } from './volition-script-runtime';

type Message = {
  id: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: string | object[] | null;
  tool_call_id?: string;
  tool_name?: string;
  reasoning?: string;
  reasoning_content?: string;
  timestamp?: number;
};
type Session = {
  id: string;
  source?: string;
  model?: string;
  started_at: number;
  last_activity_at?: number;
  ended_at?: number;
  messages: Message[];
};
type Mapping = {
  sourceKey: string;
  profile: string;
  agentId: number;
  teamId: number;
  sessions?: Record<string, { runId?: number; threadId?: string }>;
};

async function safeFile(path: string, max = 65536): Promise<string> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max)
    throw new Error(`Unsafe or oversized import file: ${path}`);
  const bytes = await readFile(path);
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return content;
}

async function filesBelow(root: string): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];
  async function walk(relative: string) {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error(`Symlink in skill: ${entry.name}`);
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else files.push({ path, content: await safeFile(join(root, path)) });
    }
  }
  await walk('');
  return files;
}

function messageOf(message: Message) {
  if (!['system', 'user', 'assistant', 'tool'].includes(message.role))
    throw new Error('Unsupported source message role');
  let content: string | Record<string, unknown>[] = message.content ?? '';
  if (message.role === 'tool')
    content = [
      {
        type: 'tool-result',
        toolCallId: message.tool_call_id,
        toolName: message.tool_name ?? 'unknown',
        output: { type: 'text', value: message.content ?? '' },
      },
    ];
  if (message.role === 'assistant') {
    const parts: Record<string, unknown>[] = [];
    const reasoning = message.reasoning_content ?? message.reasoning;
    if (reasoning) parts.push({ type: 'reasoning', text: reasoning });
    if (message.content) parts.push({ type: 'text', text: message.content });
    const calls =
      typeof message.tool_calls === 'string' ? JSON.parse(message.tool_calls) : message.tool_calls;
    for (const call of calls ?? [])
      parts.push({
        type: 'tool-call',
        toolCallId: call.id ?? call.call_id,
        toolName: call.function.name,
        input:
          typeof call.function.arguments === 'string'
            ? JSON.parse(call.function.arguments)
            : call.function.arguments,
      });
    content = parts;
  }
  return {
    role: message.role,
    content,
    text: (message.content ?? '').slice(0, 20000),
    timestamp: new Date((message.timestamp ?? 0) * 1000).toISOString(),
  };
}

export async function readProfile(mapping: Mapping) {
  const root = resolve(mapping.profile);
  if ((await lstat(root)).isSymbolicLink())
    throw new Error('Profile must be a real snapshot directory');
  const memory: { file: 'MEMORY.md' | 'USER.md'; content: string }[] = [];
  for (const file of ['MEMORY.md', 'USER.md'] as const) {
    const memoryRoot = join(root, 'memories');
    if (await Bun.file(join(memoryRoot, file)).exists()) {
      if ((await lstat(memoryRoot)).isSymbolicLink())
        throw new Error('Memory directory must not be a symlink');
      memory.push({ file, content: await safeFile(join(memoryRoot, file), 16384) });
    } else if (await Bun.file(join(root, file)).exists())
      memory.push({ file, content: await safeFile(join(root, file), 16384) });
  }
  const skills: {
    path: string;
    name: string;
    markdown: string;
    files: { path: string; content: string }[];
    otherFiles: number;
    truncated: boolean;
  }[] = [];
  const skillsRoot = join(root, 'skills');
  try {
    if ((await lstat(skillsRoot)).isSymbolicLink()) throw new Error('Skills must not be a symlink');
    async function scan(relative: string) {
      for (const entry of (await readdir(join(skillsRoot, relative), { withFileTypes: true })).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        if (entry.name === 'plan-managed' || entry.name.startsWith('.')) continue;
        if (entry.isSymbolicLink()) throw new Error(`Symlink in skills: ${entry.name}`);
        if (!entry.isDirectory()) continue;
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        const directory = join(skillsRoot, path);
        if (await Bun.file(join(directory, 'SKILL.md')).exists()) {
          const files = await filesBelow(directory);
          const markdown = files.find((file) => file.path === 'SKILL.md')!.content;
          skills.push({
            path,
            name: entry.name,
            markdown,
            files: files.filter((file) => file.path !== 'SKILL.md'),
            otherFiles: 0,
            truncated: false,
          });
        } else await scan(path);
      }
    }
    await scan('');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let sessions: Session[] = [];
  const state = join(root, 'state.db');
  if (await Bun.file(state).exists()) {
    if ((await lstat(state)).isSymbolicLink()) throw new Error('State must not be a symlink');
    if (await Bun.file(`${state}-wal`).exists())
      throw new Error('Provide a closed, checkpointed SQLite snapshot');
    const database = new Database(state, { readonly: true });
    try {
      sessions = (
        database.query('SELECT * FROM sessions ORDER BY id').all() as Omit<Session, 'messages'>[]
      ).map((session) => ({
        ...session,
        messages: database
          .query('SELECT * FROM messages WHERE session_id = ? ORDER BY id')
          .all(session.id) as Message[],
      }));
    } finally {
      database.close();
    }
  } else if (await Bun.file(join(root, 'sessions.json')).exists()) {
    sessions = JSON.parse(await safeFile(join(root, 'sessions.json'), 32 * 1024 * 1024));
  }
  return {
    sourceKey: mapping.sourceKey,
    memory,
    skills,
    sessions: sessions.map((session) => ({
      id: session.id,
      kind:
        mapping.sessions?.[session.id]?.threadId || session.source === 'chat'
          ? ('chat' as const)
          : ('reflection' as const),
      model: session.model ?? null,
      ...mapping.sessions?.[session.id],
      startedAt: new Date(session.started_at * 1000).toISOString(),
      updatedAt: new Date(
        (session.last_activity_at ?? session.ended_at ?? session.started_at) * 1000,
      ).toISOString(),
      items: session.messages.map(messageOf),
    })),
  };
}

if (import.meta.main) {
  await runVolitionScript(
    'volition-profile-import',
    process.argv.includes('--apply'),
    async ({ progress }) => {
      const args = process.argv.slice(2);
      const manifestPath = args.find((arg) => !arg.startsWith('--'));
      if (
        !manifestPath ||
        args.filter((arg) => !arg.startsWith('--')).length !== 1 ||
        args.some((arg) => arg.startsWith('--') && arg !== '--apply')
      )
        throw new Error('Usage: bun scripts/volition-profile-import.ts mapping.json [--apply]');
      const url = process.env.VOLITION_IMPORT_URL;
      const key = process.env.VOLITION_IMPORT_API_KEY;
      if (!url || !key)
        throw new Error(
          'Set VOLITION_IMPORT_URL and VOLITION_IMPORT_API_KEY for an authorized team manager',
        );
      progress('Reading mapping manifest.');
      const manifest = JSON.parse(await safeFile(resolve(manifestPath))) as Mapping[];
      for (const mapping of manifest) {
        progress(`Reading profile for agent ${mapping.agentId}.`);
        const bundle = await readProfile(mapping);
        progress(
          `Calling profile-import API for agent ${mapping.agentId} (${args.includes('--apply') ? 'apply' : 'dry-run'}).`,
        );
        const response = await fetch(
          `${url.replace(/\/+$/, '')}/teams/${mapping.teamId}/ai-agents/${mapping.agentId}/profile-import`,
          {
            method: 'POST',
            redirect: 'error',
            headers: { 'content-type': 'application/json', 'x-api-key': key },
            body: JSON.stringify({ ...bundle, apply: args.includes('--apply') }),
            signal: AbortSignal.timeout(120000),
          },
        );
        if (!response.ok)
          throw new Error(`Import refused for agent ${mapping.agentId}: HTTP ${response.status}`);
        console.log(JSON.stringify({ agentId: mapping.agentId, result: await response.json() }));
      }
    },
  );
}
