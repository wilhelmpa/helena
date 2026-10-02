import { beforeEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { aiAgent, db } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';

beforeEach(resetDb);

async function cleanupCandidate(name: string, projectKey: string) {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  expect((await api.projects.post({ key: projectKey, name: projectKey })).status).toBe(201);
  await db.execute(sql`select setval(pg_get_serial_sequence('ai_agent', 'id'), 115)`);
  const created = (
    await createAgent(api, projectKey, { name, username: 'migration-test', kind: 'external' })
  ).data!;
  expect(created.agent.id).toBe(116);
  const migration = readFileSync(
    new URL(
      '../../../../../../../../packages/db/drizzle/0234_volition_agent_trash.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const cleanup = migration.split('--> statement-breakpoint')[1];
  if (cleanup?.trim()) await db.execute(sql.raw(cleanup));
  return (await db.select().from(aiAgent).where(eq(aiAgent.id, 116)))[0];
}

test('migration moves the named ELLI test agent 116 to the recoverable trash', async () => {
  expect(
    (await cleanupCandidate('ABSCHLUSSTEST 122C Organigramm', 'ELLI')).deletedAt,
  ).not.toBeNull();
});

test('migration preserves agent 116 with another name', async () => {
  expect((await cleanupCandidate('Keep this agent', 'ELLI')).deletedAt).toBeNull();
});

test('migration preserves the named agent 116 outside ELLI', async () => {
  expect((await cleanupCandidate('ABSCHLUSSTEST 122C Organigramm', 'KEEP')).deletedAt).toBeNull();
});
