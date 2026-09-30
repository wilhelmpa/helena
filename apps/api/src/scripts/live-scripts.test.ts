import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import postgres from 'postgres';

const root = resolve(import.meta.dir, '../../../..');
const databaseUrl = process.env.VOLITION_SCRIPT_TEST_DATABASE_URL;
const databaseTest = databaseUrl ? test : test.skip;
const dbScripts = [
  { file: 'decision-profile-migrate', table: 'integration_credential' },
  { file: 'model-schema-migrate', table: 'app_setting' },
  { file: 'agent-skills-audit', table: 'ai_agent' },
];
let directory: string;
let sql: postgres.Sql | undefined;

async function cli(
  file: string,
  args: string[] = [],
  env: Record<string, string> = {},
  cwd = root,
) {
  const child = Bun.spawn([process.execPath, file, ...args], {
    cwd,
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: databaseUrl ?? '',
      APP_URL: 'http://127.0.0.1:30144',
      API_URL: 'http://127.0.0.1:31144',
      VOLITION_SCRIPT_TIMEOUT_MS: '3000',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const watchdog = setTimeout(() => child.kill(), 5000);
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
  directory = await mkdtemp(join(tmpdir(), 'volition-live-scripts-'));
  await writeFile(join(directory, 'snapshot.json'), JSON.stringify({ agents: [], library: [] }));
  await mkdir(join(directory, 'profile'));
  await writeFile(join(directory, 'profile', 'MEMORY.md'), 'Fixture memory.');
  await writeFile(
    join(directory, 'mapping.json'),
    JSON.stringify([
      {
        sourceKey: 'volition-144-fixture',
        profile: join(directory, 'profile'),
        agentId: 144,
        teamId: 145,
      },
    ]),
  );
  if (!databaseUrl) return;
  const url = new URL(databaseUrl);
  if (url.hostname !== '127.0.0.1' || !url.pathname.endsWith('_test'))
    throw new Error(
      'VOLITION_SCRIPT_TEST_DATABASE_URL must name a private loopback *_test database',
    );
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_URL = 'http://127.0.0.1:30144';
  process.env.API_URL = 'http://127.0.0.1:31144';
  sql = postgres(databaseUrl, { max: 2, prepare: false });
  await sql`insert into team(id, name) values(144, 'Volition decision fixture'), (145, 'Volition import fixture') on conflict do nothing`;
  await sql`insert into integration_credential(id, team_id, integration_key, ciphertext, iv, auth_tag, redacted)
    values(36, 144, 'decision_model', 'fixture', 'fixture', 'fixture', '{"provider":"local-logit"}'),
          (46, 144, 'decision_model', 'fixture', 'fixture', 'fixture', '{"provider":"typesafe"}') on conflict do nothing`;
  await sql`insert into helena_model_server(slug, kind, name, base_url, key_source, models)
    values('halogen', 'openai-compatible', 'Fixture', 'http://127.0.0.1:1/v1', 'none', '[{"id":"fixture-flash","capabilities":["chat"],"loaded":true}]') on conflict do nothing`;
  await sql`insert into "user"(id, name, email) values('volition-144-bot', 'Fixture coder', 'volition-144@example.invalid') on conflict do nothing`;
  await sql`insert into ai_agent(id, team_id, user_id, username, kind)
    values(144, 145, 'volition-144-bot', 'fixture-coder', 'external') on conflict do nothing`;
});

afterAll(async () => {
  if (sql) {
    const { closeDatabase } = await import('@repo/db');
    await closeDatabase();
    await sql.end({ timeout: 1 });
  }
  await rm(directory, { recursive: true, force: true });
});

async function storedState() {
  const state: unknown[] = [];
  for (const table of [
    'app_setting',
    'ai_agent',
    'integration_credential',
    'helena_decision_class_setting',
    'agent_skill_link',
    'agent_tool_link',
    'agent_mcp_server_link',
    'agent_template_sync_log',
    'volition_profile_import',
    'agent_memory_revision',
    'helena_agent_session',
    'helena_agent_session_item',
  ]) {
    state.push(
      await sql!`select coalesce(jsonb_agg(row order by row::text), '[]') as data
      from (select to_jsonb(t) as row from ${sql!(table)} t) rows`,
    );
  }
  return state;
}

for (const { file, table } of dbScripts) {
  databaseTest(
    `${file}: root and API-directory dry runs finish without database writes`,
    async () => {
      const before = await storedState();
      for (const cwd of [root, join(root, 'apps/api')]) {
        const path = cwd === root ? `apps/api/src/scripts/${file}.ts` : `src/scripts/${file}.ts`;
        const result = await cli(path, [], {}, cwd);
        expect(result.code).toBe(0);
        expect(result.stderr).toContain('Starting dry-run');
        expect(result.stderr).toContain('Finished with exit code 0');
        expect(result.stdout.length).toBeGreaterThan(0);
        if (file === 'decision-profile-migrate')
          expect(JSON.parse(result.stdout).apply).toBe(false);
        if (file === 'model-schema-migrate') expect(JSON.parse(result.stdout).applied).toBe(false);
      }
      expect(await storedState()).toEqual(before);
      expect(
        await sql!`select pid from pg_stat_activity where application_name like 'helena-%'`,
      ).toHaveLength(0);
    },
  );

  databaseTest(
    `${file}: a PostgreSQL lock emits progress and exits at the hard timeout`,
    async () => {
      let release!: () => void;
      let locked!: () => void;
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const transaction = sql!.begin(async (tx) => {
        await tx`lock table ${tx(table)} in access exclusive mode`;
        locked();
        await held;
      });
      await ready;
      try {
        const result = await cli(`apps/api/src/scripts/${file}.ts`, [], {
          VOLITION_SCRIPT_TIMEOUT_MS: '500',
        });
        expect(result.code).toBe(124);
        expect(result.stderr).toContain('Starting dry-run');
        expect(result.stderr).toContain('Hard timeout after 500 ms');
        expect(result.stderr).toContain('Reading');
        expect(result.stdout).toBe('');
      } finally {
        release();
        await transaction;
      }
    },
  );

  test(`${file}: missing database configuration reports an error and exits`, async () => {
    const result = await cli(`apps/api/src/scripts/${file}.ts`, [], { DATABASE_URL: '' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Starting dry-run');
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stderr).toContain('Finished with exit code 1');
  });

  test(`${file}: an unreachable database reports the connection error and exits`, async () => {
    const result = await cli(`apps/api/src/scripts/${file}.ts`, [], {
      DATABASE_URL: 'postgres://volition@127.0.0.1:1/volition_unreachable_test',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ECONNREFUSED');
    expect(result.stderr).toContain('Finished with exit code 1');
  });
}

test('script runtime flushes large output, closes resources and exits despite active timers', async () => {
  const result = await cli('-e', [
    `const { runVolitionScript } = await import(${JSON.stringify(join(root, 'scripts/volition-script-runtime.ts'))});
     await runVolitionScript('fixture', false, async ({ onClose }) => {
       setInterval(() => {}, 1000);
       onClose(async () => { console.error('fixture connection closed'); });
       console.log('x'.repeat(200000));
     });`,
  ]);
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(`${'x'.repeat(200000)}\n`);
  expect(result.stderr).toContain('fixture connection closed');
});

test('script runtime deadline also covers a stalled connection shutdown', async () => {
  const result = await cli(
    '-e',
    [
      `const { runVolitionScript } = await import(${JSON.stringify(join(root, 'scripts/volition-script-runtime.ts'))});
     await runVolitionScript('fixture', false, async ({ onClose }) => {
       onClose(() => new Promise(() => {}));
     });`,
    ],
    { VOLITION_SCRIPT_TIMEOUT_MS: '300' },
  );
  expect(result.code).toBe(124);
  expect(result.stderr).toContain('Hard timeout after 300 ms (closing connections)');
});

test('audit snapshot runs without a database and refuses --apply', async () => {
  const args = ['--snapshot', join(directory, 'snapshot.json')];
  const result = await cli('apps/api/src/scripts/agent-skills-audit.ts', args, {
    DATABASE_URL: '',
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('| Agent |');
  expect(result.stderr).toContain('Starting dry-run');
  const refused = await cli('apps/api/src/scripts/agent-skills-audit.ts', [...args, '--apply']);
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain('read-only copy');
});

databaseTest(
  'profile import calls the database service through local HTTP in dry-run mode',
  async () => {
    const { importProfile } = await import('../modules/agents/native-runtime/import');
    const before = await storedState();
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        expect(request.headers.get('x-api-key')).toBe('volition-test-key');
        expect(new URL(request.url).pathname).toBe('/teams/145/ai-agents/144/profile-import');
        const body = (await request.json()) as Parameters<typeof importProfile>[2];
        expect(body.apply).toBe(false);
        return Response.json(await importProfile(144, 145, body));
      },
    });
    try {
      const result = await cli(
        'scripts/volition-profile-import.ts',
        [join(directory, 'mapping.json'), '--http'],
        {
          VOLITION_IMPORT_URL: server.url.toString(),
          VOLITION_IMPORT_API_KEY: 'volition-test-key',
        },
      );
      expect(result.code).toBe(0);
      expect(result.stderr).toContain('Starting dry-run');
      expect(result.stderr).toContain('Calling profile-import API');
      expect(result.stderr).toContain('Finished with exit code 0');
      expect(JSON.parse(result.stdout).result.applied).toBe(false);
      expect(await storedState()).toEqual(before);
    } finally {
      await server.stop(true);
    }
  },
);

test('profile import has a total deadline when the HTTP service never responds', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Promise<Response>(() => {}),
  });
  try {
    const result = await cli(
      'scripts/volition-profile-import.ts',
      [join(directory, 'mapping.json'), '--http'],
      {
        VOLITION_IMPORT_URL: server.url.toString(),
        VOLITION_IMPORT_API_KEY: 'volition-test-key',
        VOLITION_SCRIPT_TIMEOUT_MS: '300',
      },
    );
    expect(result.code).toBe(124);
    expect(result.stderr).toContain('Hard timeout after 300 ms');
    expect(result.stderr).toContain('Calling profile-import API');
  } finally {
    await server.stop(true);
  }
});

test('profile import reports missing API configuration and HTTP refusal', async () => {
  const missing = await cli('scripts/volition-profile-import.ts', [
    join(directory, 'mapping.json'),
    '--http',
  ]);
  expect(missing.code).toBe(1);
  expect(missing.stderr).toContain('VOLITION_IMPORT_URL and VOLITION_IMPORT_API_KEY');
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('', { status: 403 }),
  });
  try {
    const refused = await cli(
      'scripts/volition-profile-import.ts',
      [join(directory, 'mapping.json'), '--http'],
      {
        VOLITION_IMPORT_URL: server.url.toString(),
        VOLITION_IMPORT_API_KEY: 'volition-test-key',
      },
    );
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('HTTP 403');
    expect(refused.stderr).toContain('Finished with exit code 1');
  } finally {
    await server.stop(true);
  }
});

test('invalid arguments and time limits fail before database access', async () => {
  for (const { file } of dbScripts) {
    const invalid = await cli(`apps/api/src/scripts/${file}.ts`, ['--typo'], { DATABASE_URL: '' });
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain('Usage:');
  }
  const invalid = await cli('scripts/volition-profile-import.ts', [], {
    VOLITION_SCRIPT_TIMEOUT_MS: '0',
  });
  expect(invalid.code).toBe(1);
  expect(invalid.stderr).toContain('must be an integer');
});
