import { Database } from 'bun:sqlite';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { assertRealPath, privateFile, snapshotProfiles } from './volition-profile-snapshot';
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
export type Mapping = {
  sourceKey: string;
  profile: string;
  agentId: number;
  teamId: number;
  sessions?: Record<string, { runId?: number; threadId?: string }>;
};

export async function safeFile(path: string, max = 65536): Promise<string> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max)
    throw new Error(`Unsafe or oversized import file: ${path}`);
  const bytes = await readFile(path);
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return content;
}

const excludedFile = (name: string) =>
  /^(auth\.json|\.env(?:$|\.)|vault(?:$|[._-])|tokens?(?:$|[._-]))/i.test(name);

async function filesBelow(root: string): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];
  async function walk(relative: string) {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (excludedFile(entry.name)) continue;
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

export async function readProfile(mapping: Mapping, withSessions = true) {
  const root = resolve(mapping.profile);
  await assertRealPath(root);
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
    // Hermes lists the skills it ships in skills/.bundled_manifest ("name:hash" per line).
    // They come with the runtime, not from the agent's learning, so they are not imported.
    const bundled = new Set<string>();
    if (await Bun.file(join(skillsRoot, '.bundled_manifest')).exists())
      for (const line of (await safeFile(join(skillsRoot, '.bundled_manifest'))).split('\n')) {
        const name = line.split(':')[0]?.trim();
        if (name) bundled.add(name);
      }
    async function scan(relative: string) {
      for (const entry of (await readdir(join(skillsRoot, relative), { withFileTypes: true })).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        if (entry.name === 'plan-managed' || entry.name.startsWith('.') || excludedFile(entry.name))
          continue;
        if (entry.isSymbolicLink()) throw new Error(`Symlink in skills: ${entry.name}`);
        if (!entry.isDirectory()) continue;
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        const directory = join(skillsRoot, path);
        if (await Bun.file(join(directory, 'SKILL.md')).exists()) {
          if (bundled.has(entry.name)) continue;
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
  if (withSessions && (await Bun.file(state).exists())) {
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
  } else if (withSessions && (await Bun.file(join(root, 'sessions.json')).exists())) {
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

export function parseArguments(args: string[]) {
  const usage =
    'Usage: mapping.json [--local|--http] [--apply], or --plan mapping.json [--profiles-root path], or mapping.json --snapshot target [--agent id]';
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!arg.startsWith('--')) positional.push(arg);
    else {
      if (
        ![
          '--local',
          '--http',
          '--apply',
          '--plan',
          '--snapshot',
          '--profiles-root',
          '--agent',
        ].includes(arg) ||
        options[arg] !== undefined
      )
        throw new Error(usage);
      if (['--snapshot', '--profiles-root', '--agent'].includes(arg)) {
        const value = args[++index];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
        options[arg] = value;
      } else options[arg] = true;
    }
  }
  if (
    positional.length !== 1 ||
    (options['--local'] && options['--http']) ||
    (options['--plan'] && options['--snapshot']) ||
    ((options['--plan'] || options['--snapshot']) && (options['--apply'] || options['--http'])) ||
    (options['--profiles-root'] && !options['--plan']) ||
    (options['--agent'] &&
      (!options['--snapshot'] || !/^[1-9][0-9]*$/.test(String(options['--agent']))))
  )
    throw new Error(usage);
  return { path: resolve(positional[0]!), options };
}

if (import.meta.main) {
  await runVolitionScript(
    'volition-profile-import',
    process.argv.includes('--apply'),
    async ({ progress, onClose }) => {
      const { path, options } = parseArguments(process.argv.slice(2));
      if (options['--plan']) {
        progress('Reading agent/team and session links from database.');
        const { closeDatabase } = await import('../packages/db/src');
        onClose(closeDatabase);
        const { planProfiles } = await import('../apps/api/src/scripts/volition-profile-plan');
        const profilesRoot = String(
          options['--profiles-root'] ?? '/var/lib/volition/hermes/profiles',
        );
        await assertRealPath(profilesRoot);
        const manifest = await planProfiles(profilesRoot);
        await privateFile(path, JSON.stringify(manifest, null, 2) + '\n');
        progress(`Wrote private mapping for ${manifest.length} profiles: ${path}`);
        return;
      }
      progress('Reading mapping manifest.');
      const manifest: unknown = JSON.parse(await safeFile(path, 32 * 1024 * 1024));
      if (
        !Array.isArray(manifest) ||
        !manifest.every(
          (row) =>
            row &&
            typeof row.sourceKey === 'string' &&
            typeof row.profile === 'string' &&
            Number.isSafeInteger(row.agentId) &&
            row.agentId > 0 &&
            Number.isSafeInteger(row.teamId) &&
            row.teamId > 0 &&
            (row.sessions === undefined ||
              (row.sessions && typeof row.sessions === 'object' && !Array.isArray(row.sessions))),
        )
      )
        throw new Error('Invalid mapping manifest');
      const mappings: Mapping[] = manifest.map(
        ({ sourceKey, profile, agentId, teamId, sessions }) => ({
          sourceKey,
          profile,
          agentId,
          teamId,
          sessions,
        }),
      );
      if (options['--snapshot']) {
        const selected = options['--agent']
          ? mappings.filter((row) => row.agentId === Number(options['--agent']))
          : mappings;
        if (!selected.length) throw new Error('No profiles selected for snapshot');
        await snapshotProfiles(selected, String(options['--snapshot']), progress, onClose);
        return;
      }
      let localImport:
        | typeof import('../apps/api/src/modules/agents/native-runtime/import').importProfile
        | undefined;
      const url = process.env.VOLITION_IMPORT_URL;
      const key = process.env.VOLITION_IMPORT_API_KEY;
      if (options['--http']) {
        if (!url || !key)
          throw new Error(
            'Set VOLITION_IMPORT_URL and VOLITION_IMPORT_API_KEY for an authorized team manager',
          );
      } else {
        progress('Loading local import service as system operator.');
        const { closeDatabase } = await import('../packages/db/src');
        onClose(closeDatabase);
        localImport = (await import('../apps/api/src/modules/agents/native-runtime/import'))
          .importProfile;
      }
      for (const mapping of mappings) {
        progress(`Reading profile for agent ${mapping.agentId}.`);
        const bundle = { ...(await readProfile(mapping)), apply: options['--apply'] === true };
        let result: unknown;
        if (localImport) {
          progress(`Calling local profile-import service for agent ${mapping.agentId}.`);
          result = await localImport(mapping.agentId, mapping.teamId, bundle, {
            actor: 'system',
            name: 'Wartungsskript (Owner-Auftrag)',
          });
        } else {
          progress(`Calling profile-import API for agent ${mapping.agentId}.`);
          const response = await fetch(
            `${url!.replace(/\/+$/, '')}/teams/${mapping.teamId}/ai-agents/${mapping.agentId}/profile-import`,
            {
              method: 'POST',
              redirect: 'error',
              headers: { 'content-type': 'application/json', 'x-api-key': key! },
              body: JSON.stringify(bundle),
              signal: AbortSignal.timeout(120000),
            },
          );
          if (!response.ok)
            throw new Error(`Import refused for agent ${mapping.agentId}: HTTP ${response.status}`);
          result = await response.json();
        }
        console.log(JSON.stringify({ agentId: mapping.agentId, result }));
      }
    },
  );
}
