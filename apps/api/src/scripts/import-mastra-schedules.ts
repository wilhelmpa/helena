// Moves the routines Mastra kept to the Helena engine, once, for the switch from Mastra
// (docs/helena-decisions/workflow-engine-cutover.md). Mastra stored a routine as a
// schedule of its `agent-routine` workflow in its own database (a SQLite file,
// STUDIO_DATABASE_URL of volition-mastra.service); the schedules of builder workflows are
// Helena's own and are written again from the workflows' use in the projects.
//
//   bun --env-file=<api env> src/scripts/import-mastra-schedules.ts --mastra-db <copy.db>
//   bun --env-file=<api env> src/scripts/import-mastra-schedules.ts --mastra-db <copy.db> --apply
//
// Without --apply it only prints what it would do. It reads a copy of Mastra's database
// (sqlite3 mastra.db ".backup copy.db"), never the live file, and is idempotent: a routine
// it imported before keeps its row (the Mastra schedule id is the routine's id and its
// key `mastra:<id>`), so running it again changes nothing. Imported routines start
// afresh: the times Mastra did not fire before the switch are not fired afterwards.

import { Database } from 'bun:sqlite';
import { aiAgent, db, helenaSchedule, issue, project, projectMember, user } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { syncAllPipelineSchedules } from '#modules/pipelines/service';

const ROUTINE_WORKFLOW = 'agent-routine';
const DEFAULT_TIMEZONE = 'Europe/Berlin';

interface MastraScheduleRow {
  id: string;
  target: string | null;
  cron: string;
  timezone: string | null;
  status: string;
  metadata: string | null;
  created_at: number | bigint;
}

type Json = Record<string, unknown>;

function parse(value: unknown): Json {
  if (value && typeof value === 'object') return value as Json;
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function args() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--mastra-db');
  return { mastraDb: at >= 0 ? argv[at + 1] : undefined, apply: argv.includes('--apply') };
}

async function projectByRef(ref: string) {
  const key = ref.startsWith('project:') ? ref.slice('project:'.length) : '';
  if (!key) return null;
  const [row] = await db
    .select({ id: project.id, key: project.key })
    .from(project)
    .where(eq(project.key, key));
  return row ?? null;
}

// The agent a routine names (agent:<username>), when it still works in the project.
async function agentOf(projectId: number, ref: string) {
  const username = ref.startsWith('agent:') ? ref.slice('agent:'.length) : '';
  if (!username) return null;
  const [row] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .innerJoin(
      projectMember,
      and(eq(projectMember.userId, aiAgent.userId), eq(projectMember.projectId, projectId)),
    )
    .where(eq(aiAgent.username, username));
  return row?.id ?? null;
}

// The task a reopening routine names (task:<KEY>-<number>).
async function taskOf(projectId: number, key: string, ref: string) {
  const match = new RegExp(`^task:${key}-(\\d+)$`).exec(ref);
  if (!match) return null;
  const [row] = await db
    .select({ id: issue.id })
    .from(issue)
    .where(and(eq(issue.projectId, projectId), eq(issue.sequenceNumber, Number(match[1]))));
  return row?.id ?? null;
}

async function userOf(id: string) {
  if (!id) return null;
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.id, id));
  return row?.id ?? null;
}

function readMastra(path: string): MastraScheduleRow[] {
  const sqlite = new Database(path, { readonly: true });
  try {
    return sqlite
      .query(
        'SELECT id, target, cron, timezone, status, metadata, created_at FROM mastra_schedules',
      )
      .all() as MastraScheduleRow[];
  } finally {
    sqlite.close();
  }
}

export async function importMastraRoutines({
  mastraDb,
  apply,
  log = console.log,
}: {
  mastraDb?: string;
  apply: boolean;
  log?: (line: string) => void;
}): Promise<{ imported: number; kept: number; skipped: number }> {
  const rows = mastraDb ? readMastra(mastraDb) : [];
  if (!mastraDb) log('No --mastra-db given: no routines to import.');
  let imported = 0;
  let kept = 0;
  let skipped = 0;
  for (const row of rows) {
    const target = parse(row.target);
    const metadata = parse(row.metadata);
    if (text(target.workflowId) !== ROUTINE_WORKFLOW) continue;
    const input = parse(target.inputData);
    const payload = parse(input.payload);
    const context = parse(target.requestContext);
    const owner = await projectByRef(text(context.projectRef) || text(metadata.projectRef));
    if (!owner) {
      log(`skip ${row.id}: its project is gone`);
      skipped += 1;
      continue;
    }
    const mode = payload.mode === 'reopen' ? 'reopen' : 'new';
    const agentId = await agentOf(owner.id, text(payload.agentRef));
    const taskId =
      mode === 'reopen' ? await taskOf(owner.id, owner.key, text(payload.taskRef)) : null;
    const actor = await userOf(text(parse(input.actor).id));
    const title = text(payload.title) || 'Routine';
    const values = {
      id: row.id,
      projectId: owner.id,
      kind: 'routine' as const,
      title: title.slice(0, 300),
      agentId,
      instructions: text(payload.instructions),
      mode,
      taskId,
      cron: row.cron,
      timezone: row.timezone || DEFAULT_TIMEZONE,
      catchUp: 'skip' as const,
      enabled: row.status === 'active',
      firedThrough: new Date(),
      actorUserId: actor,
      scheduleKey: `mastra:${row.id}`,
      createdBy: actor,
      createdAt: new Date(Number(row.created_at)),
    };
    const [existing] = await db
      .select({ id: helenaSchedule.id })
      .from(helenaSchedule)
      .where(eq(helenaSchedule.id, row.id));
    const line = `${owner.key} "${values.title}" ${values.cron} ${values.timezone} ${
      values.enabled ? 'on' : 'off'
    }${agentId ? '' : ' (agent left the project)'}${
      mode === 'reopen' && !taskId ? ' (task gone)' : ''
    }`;
    if (existing) {
      log(`keep ${row.id}: ${line}`);
      kept += 1;
      continue;
    }
    log(`${apply ? 'import' : 'would import'} ${row.id}: ${line}`);
    if (apply) await db.insert(helenaSchedule).values(values).onConflictDoNothing();
    imported += 1;
  }
  const workflows = apply ? await syncAllPipelineSchedules() : 0;
  log(
    `${apply ? 'Imported' : 'Would import'} ${imported} routine(s), kept ${kept}, skipped ${skipped}` +
      (apply ? `; schedules of ${workflows} workflow(s) written again.` : '. Run with --apply.'),
  );
  return { imported, kept, skipped };
}

if (import.meta.main) {
  await importMastraRoutines(args());
  process.exit(0);
}
