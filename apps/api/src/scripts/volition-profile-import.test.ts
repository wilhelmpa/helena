import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, mkdir, writeFile, lstat, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { readProfile, type Mapping } from '../../../../scripts/volition-profile-import';

const root = resolve(import.meta.dir, '../../../..');
const url = process.env.VOLITION_SCRIPT_TEST_DATABASE_URL;
const databaseTest = url ? test : test.skip;
let directory: string;
let sql: postgres.Sql;
let writer: Database;
let mapping: Mapping;

async function cli(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, 'scripts/volition-profile-import.ts', ...args], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: url ?? '',
      APP_URL: 'http://127.0.0.1:30145',
      API_URL: 'http://127.0.0.1:31145',
      VOLITION_SCRIPT_TIMEOUT_MS: '10000',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const watchdog = setTimeout(() => child.kill(), 12000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(watchdog);
  }
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'volition-profile-145-'));
  const profile = join(directory, 'profiles', 'demo_145');
  await mkdir(join(profile, 'memories'), { recursive: true });
  await writeFile(join(profile, 'memories', 'MEMORY.md'), 'Synthetic memory.');
  for (const name of ['learned', 'plan-managed']) {
    await mkdir(join(profile, 'skills', name), { recursive: true });
    await writeFile(
      join(profile, 'skills', name, 'SKILL.md'),
      '# Learned procedure\nUse the fixture.',
    );
  }
  await writeFile(join(profile, 'skills', 'learned', 'reference.txt'), 'Synthetic reference.');
  for (const name of ['auth.json', '.env', 'tokens.json', 'vault.json']) {
    await writeFile(join(profile, name), 'MUST NOT BE COPIED', { mode: 0 });
    await writeFile(join(profile, 'skills', 'learned', name), 'MUST NOT BE COPIED', { mode: 0 });
  }
  writer = new Database(join(profile, 'state.db'));
  writer.exec(
    'PRAGMA journal_mode=WAL; CREATE TABLE sessions(id TEXT, source TEXT, started_at INTEGER); CREATE TABLE messages(id INTEGER, session_id TEXT, role TEXT, content TEXT, timestamp INTEGER);',
  );
  writer.exec(
    "INSERT INTO sessions VALUES ('run-fixture', 'cli', 1), ('private-fixture', 'chat', 1); INSERT INTO messages VALUES (1, 'run-fixture', 'user', 'Latest WAL message', 1), (2, 'private-fixture', 'user', 'Private fixture', 1);",
  );
  mapping = {
    sourceKey: 'hermes:demo_145:145',
    profile,
    agentId: 145,
    teamId: 145,
    sessions: {
      'run-fixture': { runId: 145 },
      'private-fixture': { threadId: 'volition-145-owner-thread' },
    },
  };
  await writeFile(join(directory, 'mapping.json'), JSON.stringify([mapping]));
  if (!url) return;
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || !parsed.pathname.endsWith('_test'))
    throw new Error('Private loopback test database required');
  sql = postgres(url, { max: 2, prepare: false });
  await sql`delete from ai_agent where id in (145,146)`;
  await sql`insert into team(id, name) values(145, 'Profile fixture') on conflict do nothing`;
  await sql`insert into "user"(id, name, email) values('volition-145-owner', 'Fixture', 'volition-145-owner@example.invalid'), ('volition-145-agent', 'Agent', 'volition-145-agent@example.invalid'), ('volition-146-agent', 'Coordinator', 'volition-146-agent@example.invalid') on conflict do nothing`;
  await sql`insert into ai_agent(id, team_id, user_id, username, kind) values(145,145,'volition-145-agent','fixture-145','external'), (146,145,'volition-146-agent','demo-koordinator','external') on conflict do nothing`;
  await sql`insert into project(id,team_id,key,name) values(145,145,'DEMO','Fixture') on conflict do nothing`;
  await sql`insert into agent_run(id,agent_id,project_id,prompt,status,session_id) values(145,145,145,'Fixture','success','run-fixture') on conflict do nothing`;
  await sql`insert into agent_chat_thread(id,agent_id,user_id,cli_session_id) values('volition-145-owner-thread',145,'volition-145-owner','private-fixture') on conflict do nothing`;
  await sql`insert into agent_chat_message(id,thread_id,agent_id,role,status,session_id) values(145,'volition-145-owner-thread',145,'assistant','success','private-fixture') on conflict do nothing`;
});

afterAll(async () => {
  writer?.close();
  await sql?.end({ timeout: 1 });
  await rm(directory, { recursive: true, force: true });
});

async function state() {
  return Promise.all(
    [
      'agent_memory_revision',
      'volition_profile_import',
      'helena_agent_session',
      'helena_agent_session_item',
      'ai_agent',
    ].map((table) => sql.unsafe(`select * from ${table} order by 1`)),
  );
}

test('snapshot uses SQLite backup including committed WAL, only allowed files and private permissions', async () => {
  const target = join(directory, 'snapshot');
  const result = await cli([join(directory, 'mapping.json'), '--snapshot', target], {
    DATABASE_URL: '',
  });
  expect(result.code).toBe(0);
  expect(result.stderr).toContain('SQLite read-only backup');
  expect(result.stderr).toContain('Finished with exit code 0');
  expect((await lstat(target)).mode & 0o777).toBe(0o700);
  expect((await lstat(join(target, 'mapping.json'))).mode & 0o777).toBe(0o600);
  const [snapshot] = (await Bun.file(join(target, 'mapping.json')).json()) as Mapping[];
  mapping = snapshot!;
  expect(await readdir(mapping.profile)).toEqual(
    expect.arrayContaining(['MEMORY.md', 'skills', 'state.db']),
  );
  for (const file of [
    'auth.json',
    '.env',
    'tokens.json',
    'vault.json',
    'state.db-wal',
    'state.db-shm',
    'skills/plan-managed',
    'skills/learned/auth.json',
    'skills/learned/.env',
    'skills/learned/tokens.json',
    'skills/learned/vault.json',
  ])
    expect(await Bun.file(join(mapping.profile, file)).exists()).toBe(false);
  const bundle = await readProfile(mapping);
  expect(bundle.sessions[0]!.items[0]!.text).toBe('Private fixture');
  expect(bundle.sessions[1]!.items[0]!.text).toBe('Latest WAL message');
  expect(bundle.skills).toHaveLength(1);
  expect(bundle.skills[0]!.files).toEqual([
    { path: 'reference.txt', content: 'Synthetic reference.' },
  ]);
  expect((await lstat(join(mapping.profile, 'state.db'))).mode & 0o777).toBe(0o600);
  expect(await cli([join(directory, 'mapping.json'), '--snapshot', target])).toMatchObject({
    code: 1,
  });
});

test('import refuses active WAL and snapshot refuses symlink source', async () => {
  await expect(
    readProfile({ ...mapping, profile: join(directory, 'profiles', 'demo_145') }),
  ).rejects.toThrow('closed, checkpointed');
  await symlink(join(directory, 'profiles'), join(directory, 'linked-profiles'));
  await writeFile(
    join(directory, 'symlink.json'),
    JSON.stringify([{ ...mapping, profile: join(directory, 'linked-profiles', 'demo_145') }]),
  );
  expect(
    (await cli([join(directory, 'symlink.json'), '--snapshot', join(directory, 'bad-snapshot')]))
      .stderr,
  ).toContain('Symlink');
});

test('snapshot agent selection avoids accessing other isolated profiles', async () => {
  const path = join(directory, 'selection.json');
  await writeFile(
    path,
    JSON.stringify([mapping, { ...mapping, agentId: 999, profile: '/missing-isolated-profile' }]),
  );
  const target = join(directory, 'selected-snapshot');
  const result = await cli([path, '--snapshot', target, '--agent', '145'], { DATABASE_URL: '' });
  expect(result.code).toBe(0);
  expect((await Bun.file(join(target, 'mapping.json')).json()).length).toBe(1);
});

databaseTest(
  'plan resolves suffixed and coordinator profiles, run and owner chat IDs into a private mapping',
  async () => {
    await mkdir(join(directory, 'profiles', 'demo'));
    const path = join(directory, 'plan-private', 'mapping.json');
    const result = await cli(['--plan', path, '--profiles-root', join(directory, 'profiles')]);
    expect(result.code).toBe(0);
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    expect((await lstat(join(directory, 'plan-private'))).mode & 0o777).toBe(0o700);
    const rows = (await Bun.file(path).json()) as Mapping[];
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.agentId === 145)).toMatchObject({
      teamId: 145,
      sessions: mapping.sessions,
      sourceKey: mapping.sourceKey,
    });
    expect(rows.find((row) => row.agentId === 146)?.profile).toBe(
      join(directory, 'profiles', 'demo'),
    );
    expect((await cli(['--plan', path, '--profiles-root', join(directory, 'profiles')])).code).toBe(
      1,
    );
  },
);

databaseTest(
  'plan gives a session continued by resumed runs to its first run, but refuses a run on a chat session',
  async () => {
    await sql`insert into agent_run(id,agent_id,project_id,prompt,status,session_id) values(1452,145,145,'Resumed','success','run-fixture'),(1451,145,145,'Resumed','success','run-fixture') on conflict do nothing`;
    try {
      const path = join(directory, 'plan-resumed', 'mapping.json');
      const result = await cli(['--plan', path, '--profiles-root', join(directory, 'profiles')]);
      expect(result.code).toBe(0);
      const rows = (await Bun.file(path).json()) as Mapping[];
      expect(rows.find((row) => row.agentId === 145)?.sessions).toEqual(mapping.sessions);
      await sql`insert into agent_run(id,agent_id,project_id,prompt,status,session_id) values(1453,145,145,'Crossed','success','private-fixture') on conflict do nothing`;
      const crossed = await cli([
        '--plan',
        join(directory, 'plan-crossed', 'mapping.json'),
        '--profiles-root',
        join(directory, 'profiles'),
      ]);
      expect(crossed.code).toBe(1);
      expect(crossed.stderr + crossed.stdout).toContain(
        'Ambiguous session ownership for agent 145',
      );
    } finally {
      await sql`delete from agent_run where id in (1451,1452,1453)`;
    }
  },
);

databaseTest(
  'local dry-run, apply, unchanged retry and conflict preserve atomic import and system audit',
  async () => {
    const path = join(directory, 'snapshot', 'mapping.json');
    const before = await state();
    const dry = await cli([path]);
    expect(dry.code).toBe(0);
    expect(JSON.parse(dry.stdout).result).toMatchObject({
      applied: false,
      unchanged: false,
      memory: 1,
      skills: 1,
    });
    expect(await state()).toEqual(before);
    const apply = await cli([path, '--local', '--apply']);
    expect(apply.code).toBe(0);
    expect(JSON.parse(apply.stdout).result.applied).toBe(true);
    const [journal] = await sql`select audit from volition_profile_import where agent_id=145`;
    expect(journal!.audit).toEqual({ actor: 'system', name: 'Wartungsskript (Owner-Auftrag)' });
    const applied = await state();
    const repeat = await cli([path, '--apply']);
    expect(repeat.code).toBe(0);
    expect(JSON.parse(repeat.stdout).result.unchanged).toBe(true);
    expect(await state()).toEqual(applied);
    await writeFile(join(mapping.profile, 'MEMORY.md'), 'Changed fixture.');
    const conflict = await cli([path, '--apply']);
    expect(conflict.code).toBe(1);
    expect(conflict.stderr).toContain('different content');
    expect(await state()).toEqual(applied);
    await writeFile(join(mapping.profile, 'MEMORY.md'), 'Synthetic memory.');
  },
);

databaseTest(
  'private chat without owner thread refuses all writes and leaves no source journal',
  async () => {
    const isolated = join(directory, 'unowned');
    await mkdir(isolated);
    await writeFile(join(isolated, 'MEMORY.md'), 'Would be imported');
    await writeFile(
      join(isolated, 'sessions.json'),
      JSON.stringify([
        { id: 'valid-before-private', source: 'cli', started_at: 1, messages: [] },
        { id: 'unowned-private-chat', source: 'chat', started_at: 1, messages: [] },
      ]),
    );
    const path = join(directory, 'unowned.json');
    const before = await state();
    await writeFile(
      path,
      JSON.stringify([
        { ...mapping, agentId: 146, sourceKey: 'unowned-146', profile: isolated, sessions: {} },
      ]),
    );
    const unowned = await cli([path, '--apply']);
    expect(unowned.code).toBe(1);
    expect(unowned.stderr).toContain('existing owner thread');
    expect(await state()).toEqual(before);
  },
);

databaseTest('local import deadline interrupts a PostgreSQL agent lock', async () => {
  let release!: () => void;
  let ready!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const blocker = sql.begin(async (tx) => {
    await tx`select id from ai_agent where id=145 for update`;
    ready();
    await held;
  });
  await started;
  try {
    const result = await cli([join(directory, 'snapshot', 'mapping.json')], {
      VOLITION_SCRIPT_TIMEOUT_MS: '1000',
    });
    expect(result.code).toBe(124);
    expect(result.stderr).toContain('Hard timeout');
  } finally {
    release();
    await blocker;
  }
});
