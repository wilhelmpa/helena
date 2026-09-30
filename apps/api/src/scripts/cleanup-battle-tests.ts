import postgres from 'postgres';
import { closeDatabase } from '@repo/db';
import { lstat, readdir, readFile } from 'node:fs/promises';
import {
  absoluteVaultPath,
  assertNoSymlink,
  commitVaultPaths,
  indexVaultPaths,
  PLAN_AUTHOR,
  trashVaultPath,
} from '@repo/vault';
import { nativeSkillAction } from '../modules/agents/native-runtime/skills';
import { deleteSkill } from '../modules/agents/skills/service';

const START = '2026-09-29T22:00:00Z';
const END = '2026-09-30T22:00:00Z';
const MARKER = /^\s*(?:#+\s*)?(?:\[Battle-Test\]|battle-test-[a-z0-9-]+)/i;
type Item = { id: number | string; label: string };

async function battleFiles(): Promise<string[]> {
  const base = 'Projects/VOL/Inbox';
  const found: string[] = [];
  async function visit(relative: string) {
    const path = absoluteVaultPath(relative);
    await assertNoSymlink(relative);
    const info = await lstat(path);
    if (info.isDirectory()) {
      for (const name of await readdir(path)) await visit(`${relative}/${name}`);
    } else if (
      info.isFile() &&
      info.size < 1024 * 1024 &&
      /\.(md|txt|json|canvas|ya?ml)$/i.test(relative)
    ) {
      const today = info.mtime >= new Date(START) && info.mtime < new Date(END);
      const content = await readFile(path, 'utf8');
      if (today && (MARKER.test(content) || /battle[- ]test/i.test(relative))) found.push(relative);
    }
  }
  try {
    await lstat(absoluteVaultPath(base));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return found;
    throw error;
  }
  await visit(base);
  return found.sort();
}

export async function cleanupBattleTests(
  options: { apply?: boolean; log?: (line: string) => void } = {},
) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  const log = options.log ?? console.log;
  const files = await battleFiles();
  try {
    const plan = await client.begin(async (tx) => {
      if (!options.apply) await tx`set transaction read only`;
      else await tx`select pg_advisory_xact_lock(166, 20260930)`;
      const tasks = await tx<Item[]>`
        select i.id, p.key || '-' || i.sequence_number || ': ' || i.title as label
        from issue i join project p on p.id = i.project_id
        where i.created_at >= ${START} and i.created_at < ${END}
          and ((p.key = 'VOL' and position('[Battle-Test]' in i.title) > 0)
            or (p.key = 'TRADE' and i.sequence_number = 57 and i.title = 'Kurzer Marktüberblick SPY (Testlauf)'))`;
      const taskIds = tasks.map((row) => Number(row.id));
      const routines = await tx<Item[]>`
        select s.id, s.title as label from helena_schedule s join project p on p.id = s.project_id
        where p.key in ('VOL', 'TRADE') and s.kind = 'routine'
          and (s.task_id = any(${taskIds}::int[]) or
            (s.created_at >= ${START} and s.created_at < ${END}
              and (s.title ~* '^\\[Battle-Test\\]|^battle-test-' or s.instructions ~* '^\\[Battle-Test\\]|^battle-test-')))`;
      const routineIds = routines.map((row) => String(row.id));
      const chats = await tx<Item[]>`
        select t.id, coalesce(t.title, 'Test chat') as label from agent_chat_thread t
        left join project p on p.id = t.project_id
        where t.issue_id = any(${taskIds}::int[]) or
          (t.created_at >= ${START} and t.created_at < ${END} and p.key in ('VOL', 'TRADE')
            and (t.title ~* '^\\[Battle-Test\\]|^battle-test-' or exists (
              select 1 from agent_chat_message m where m.thread_id = t.id and m.role = 'user'
                and m.id = (select min(first.id) from agent_chat_message first where first.thread_id = t.id and first.role = 'user')
                and m.content ~* '^\\[Battle-Test\\]|^battle-test-')))`;
      const chatIds = chats.map((row) => String(row.id));
      const runs = await tx<Item[]>`
        select r.id, coalesce(r.title, r.kind) as label from pipeline_run r join project p on p.id = r.project_id
        where r.issue_id = any(${taskIds}::int[]) or r.schedule_id = any(${routineIds}::text[])
          or (r.created_at >= ${START} and r.created_at < ${END} and p.key in ('VOL', 'TRADE')
            and r.title ~* '^\\[Battle-Test\\]|^battle-test-')`;
      const runIds = runs.map((row) => String(row.id));
      const agentRuns = await tx<Item[]>`
        select r.id, 'Agent run ' || r.id as label from agent_run r
        where r.issue_id = any(${taskIds}::int[]) or r.id in (
          select agent_run_id from pipeline_run_step where run_id = any(${runIds}::text[]))`;
      const agentRunIds = agentRuns.map((row) => Number(row.id));
      const facts = await tx<Item[]>`
        select id, 'Marked Battle-Test fact ' || id as label from helena_fact
        where created_at >= ${START} and created_at < ${END} and deleted_at is null
          and (content ~* '^\\[Battle-Test\\]|^battle-test-' or 'battle-test' = any(tags))`;
      const skills = await tx<(Item & { team_id: number })[]>`
        select s.id, s.name as label, s.team_id from agent_skill s
        where s.name = 'battle-test-meta-description'
          and s.created_at >= ${START} and s.created_at < ${END}
          and exists (select 1 from agent_skill_link l where l.skill_id = s.id and l.agent_id = 12)
          and not exists (select 1 from agent_skill_link l where l.skill_id = s.id and l.agent_id <> 12)`;
      const nativeSkills = await tx<{ id: string; label: string; needs_review: boolean }[]>`
        select s->>'path' as id, s->>'name' as label,
          exists (select 1 from jsonb_array_elements(coalesce(s->'history', '[]'::jsonb)) h where h->>'status' = 'pending') as needs_review
        from ai_agent a cross join lateral jsonb_array_elements(a.volition_learned_skills) s
        where a.id = 12 and s->>'name' = 'battle-test-meta-description'
          and coalesce((s->>'archived')::boolean, false) = false
          and (s->>'createdAt')::timestamptz >= ${START} and (s->>'createdAt')::timestamptz < ${END}`;
      const plan = { tasks, routines, chats, runs, agentRuns, facts, skills, nativeSkills, files };
      log(
        JSON.stringify(
          { mode: options.apply ? 'apply' : 'dry-run', date: '2026-09-30 Europe/Berlin', ...plan },
          null,
          2,
        ),
      );
      if (!options.apply) return plan;
      await tx`select id from issue where id = any(${taskIds}::int[]) for update`;
      await tx`select id from helena_schedule where id = any(${routineIds}::text[]) for update`;
      await tx`select id from agent_chat_thread where id = any(${chatIds}::text[]) for update`;
      await tx`select id from pipeline_run where id = any(${runIds}::text[]) for update`;
      await tx`select id from agent_run where id = any(${agentRunIds}::int[]) for update`;
      if (nativeSkills.some((skill) => skill.needs_review))
        throw new Error('Review the pending test skill proposal before cleanup');
      const active = await tx`
        select id::text from pipeline_run where id = any(${runIds}::text[]) and status in ('pending', 'running', 'waiting')
        union all select id::text from agent_run where id = any(${agentRunIds}::int[]) and status = 'pending'
        union all select id::text from agent_chat_message where thread_id = any(${chatIds}::text[]) and status in ('pending', 'streaming')`;
      if (active.length)
        throw new Error('Active test work remains; cancel it through the API before cleanup');
      await tx`delete from helena_schedule where id = any(${routineIds}::text[])`;
      await tx`delete from agent_chat_thread where id = any(${chatIds}::text[])`;
      await tx`delete from pipeline_run where id = any(${runIds}::text[])`;
      await tx`delete from agent_run where id = any(${agentRunIds}::int[])`;
      await tx`update helena_fact set deleted_at = now(), updated_at = now() where id = any(${facts.map((row) => Number(row.id))}::int[])`;
      await tx`delete from issue where id = any(${taskIds}::int[])`;
      return plan;
    });
    if (options.apply) {
      for (const skill of plan.skills) {
        const links =
          await client`select agent_id from agent_skill_link where skill_id = ${Number(skill.id)}`;
        if (links.length === 1 && links[0]!.agent_id === 12)
          await deleteSkill(Number(skill.id), skill.team_id);
        else log(`Skipped changed skill ${skill.id}`);
      }
      for (const skill of plan.nativeSkills) await nativeSkillAction(12, skill.id, null);
      const currentFiles = new Set(plan.files.length ? await battleFiles() : []);
      for (const relative of plan.files) {
        if (!currentFiles.has(relative)) {
          log(`Skipped changed file ${relative}`);
          continue;
        }
        const target = await trashVaultPath(relative);
        await indexVaultPaths([relative, target]);
        await commitVaultPaths([relative], 'Remove marked Battle-Test file', PLAN_AUTHOR);
      }
    }
    return plan;
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  if (process.argv.slice(2).some((arg) => arg !== '--apply'))
    throw new Error('Usage: cleanup-battle-tests.ts [--apply]');
  try {
    await cleanupBattleTests({ apply: process.argv.includes('--apply') });
  } finally {
    await closeDatabase();
  }
}
