import { beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, helenaSchedule } from '@repo/db';
import { createAgent } from '#tests/helpers/agents';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { importMastraRoutines } from './import-mastra-schedules';

// The one-time move of Mastra's routines: read from a copy of Mastra's SQLite database,
// written once, and a second run changes nothing.

function mastraCopy(rows: { id: string; target: unknown; status: string; cron?: string }[]) {
  const path = join(mkdtempSync(join(tmpdir(), 'mastra-copy-')), 'mastra.db');
  const sqlite = new Database(path);
  sqlite.run(`CREATE TABLE mastra_schedules (
    id TEXT PRIMARY KEY, target TEXT, cron TEXT, timezone TEXT, status TEXT,
    next_fire_at INTEGER, last_fire_at INTEGER, last_run_id TEXT,
    created_at INTEGER, updated_at INTEGER, metadata TEXT, owner_type TEXT, owner_id TEXT)`);
  for (const row of rows)
    sqlite.run(
      'INSERT INTO mastra_schedules (id, target, cron, timezone, status, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        row.id,
        JSON.stringify(row.target),
        row.cron ?? '0 9 * * 1',
        'Europe/Berlin',
        row.status,
        Date.parse('2026-09-01T10:00:00Z'),
        Date.parse('2026-09-01T10:00:00Z'),
        JSON.stringify({ projectRef: 'project:MKT', source: 'itsaplan', scheduleKey: row.id }),
      ],
    );
  sqlite.close();
  return path;
}

describe('Mastra routine import', () => {
  beforeEach(resetDb);

  it('imports the routines of a Mastra copy once, and leaves other schedules alone', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const asOwner = authedApi(owner.cookie);
    await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
    const task = (
      await asOwner.projects({ projectKey: 'MKT' }).issues.post({
        columnId: (await asOwner.projects({ projectKey: 'MKT' }).get()).data!.columns[0]!.id,
        title: 'Backups',
      })
    ).data!;
    const agent = (
      await createAgent(asOwner, 'MKT', { name: 'Writer', username: 'writer' } as never)
    ).data!.agent;
    const routine = (payload: Record<string, unknown>) => ({
      type: 'workflow',
      workflowId: 'agent-routine',
      inputData: { actor: { type: 'human', id: owner.userId }, payload },
      requestContext: { projectRef: 'project:MKT' },
    });
    const path = mastraCopy([
      {
        id: 'weekly',
        status: 'active',
        target: routine({
          agentRef: 'agent:writer',
          title: 'Weekly report',
          instructions: 'Summarize the week.',
          mode: 'new',
        }),
      },
      {
        id: 'backups',
        status: 'paused',
        cron: '0 7 * * *',
        target: routine({
          agentRef: 'agent:gone',
          title: 'Check backups',
          instructions: 'Look at the backups.',
          mode: 'reopen',
          taskRef: `task:MKT-${task.sequenceNumber}`,
        }),
      },
      { id: 'pipeline', status: 'active', target: { workflowId: 'plan-pipeline' } },
      {
        id: 'elsewhere',
        status: 'active',
        target: { ...routine({}), requestContext: { projectRef: 'project:NOPE' } },
      },
    ]);

    const lines: string[] = [];
    const dry = await importMastraRoutines({
      mastraDb: path,
      apply: false,
      log: (line) => lines.push(line),
    });
    expect(dry).toEqual({ imported: 2, kept: 0, skipped: 1 });
    expect(await db.select().from(helenaSchedule)).toEqual([]);

    expect(await importMastraRoutines({ mastraDb: path, apply: true, log: () => {} })).toEqual({
      imported: 2,
      kept: 0,
      skipped: 1,
    });
    const rows = await db.select().from(helenaSchedule).orderBy(helenaSchedule.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'backups',
      kind: 'routine',
      agentId: null,
      mode: 'reopen',
      taskId: task.id,
      cron: '0 7 * * *',
      enabled: false,
      scheduleKey: 'mastra:backups',
    });
    expect(rows[1]).toMatchObject({
      id: 'weekly',
      agentId: agent.id,
      title: 'Weekly report',
      instructions: 'Summarize the week.',
      mode: 'new',
      timezone: 'Europe/Berlin',
      catchUp: 'skip',
      enabled: true,
      actorUserId: owner.userId,
    });
    // Again: nothing changes.
    expect(await importMastraRoutines({ mastraDb: path, apply: true, log: () => {} })).toEqual({
      imported: 0,
      kept: 2,
      skipped: 1,
    });
    expect(await db.select().from(helenaSchedule)).toHaveLength(2);
  });
});
