import { beforeEach, expect, test } from 'bun:test';
import { aiAgent, db, setDisplayName } from '@repo/db';
import { eq } from 'drizzle-orm';
import { resolve } from 'node:path';
import { apiKeyApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { bootstrapHomeAgent } from '../../../bootstrap-home-agent';

beforeEach(resetDb);

test('CLI defaults to dry-run, applies atomically and remains dynamic and idempotent', async () => {
  await signUpTestUser();
  const home = await bootstrapHomeAgent();
  if (home.status !== 'ready') throw new Error('No fixture Home');
  await db
    .update(aiAgent)
    .set({
      instructions: 'Du bist Home, der Master-Agent von Helena. Frage Helena Müller.',
      heartbeatInstructions: 'Prüfe Aufgaben in Helena.',
      runtimePolicy: {
        runtime: 'hermes',
        files: [
          { kind: 'instructions', path: 'SOUL.md', content: 'Ich bin Home, hier bei Helena.' },
        ],
      },
    })
    .where(eq(aiAgent.id, home.agentId));
  const cli = resolve(import.meta.dir, '../../../migrate-agent-product-name.ts');
  const run = (...args: string[]) => {
    const result = Bun.spawnSync(['bun', cli, ...args], { env: process.env });
    expect(result.exitCode).toBe(0);
    return new TextDecoder().decode(result.stdout);
  };
  expect(run()).toContain('DRY RUN: 1 agent(s)');
  const read = async () =>
    (await db.select().from(aiAgent).where(eq(aiAgent.id, home.agentId)))[0]!;
  expect((await read()).instructions).toContain('von Helena.');
  expect(run('--apply')).toContain('Updated 1 agent(s).');
  expect((await read()).instructions).toBe(
    'Du bist Home, der Master-Agent von {appName}. Frage Helena Müller.',
  );
  expect(run('--apply')).toContain('APPLY: 0 agent(s)');
  await setDisplayName('Atlas');
  const api = apiKeyApi(home.apiKey);
  const first = await api['agent-runtime'].policy.get();
  expect(first.status).toBe(200);
  expect(first.data?.instructions).toContain('von Atlas.');
  expect(first.data?.runtimePolicy.files[0]?.content).toContain('hier bei Atlas.');
  expect(first.data?.runtimePolicy.files[0]?.content).not.toContain('{appName}');
  await setDisplayName('Nova');
  const second = await api['agent-runtime'].policy.get();
  expect(second.data?.instructions).toContain('von Nova.');
});
