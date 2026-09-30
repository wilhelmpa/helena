import { randomUUID } from 'node:crypto';
import {
  aiAgent,
  agentChatMessage,
  agentChatThread,
  db,
  project,
  team,
  teamMember,
  user,
  volitionTrashPurge,
} from '@repo/db';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  listVaultTrashRecords,
  locateVaultPath,
  purgeVaultTrash,
  type TrashRecord,
} from '@repo/vault';
import { deleteThread } from '#modules/agents/chat/service';
import { HttpError } from '#shared/lib';

export const DAY_MS = 86_400_000;
export type TrashKind = 'chat' | 'vault';
export interface TrashScope {
  teamId?: number;
  projectId?: number;
  userId?: string;
  includeHome?: boolean;
}
export interface TrashCounts {
  kind: TrashKind;
  teamId: number | null;
  projectId: number | null;
  count: number;
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function purgeAt(deletedAt: Date | string, days: number): string | null {
  return days === 0 ? null : new Date(new Date(deletedAt).getTime() + days * DAY_MS).toISOString();
}

export async function teamRetention(teamId: number) {
  const [row] = await db
    .select({ days: team.trashRetentionDays })
    .from(team)
    .where(eq(team.id, teamId));
  if (!row) throw new HttpError(404, 'Team not found');
  return { days: row.days };
}

export async function setTeamRetention(teamId: number, days: number) {
  await db.update(team).set({ trashRetentionDays: days }).where(eq(team.id, teamId));
  return teamRetention(teamId);
}

export async function projectRetention(projectId: number) {
  const [row] = await db
    .select({ days: project.trashRetentionDays, teamDays: team.trashRetentionDays })
    .from(project)
    .innerJoin(team, eq(team.id, project.teamId))
    .where(eq(project.id, projectId));
  if (!row) throw new HttpError(404, 'Project not found');
  return { days: row.days, effectiveDays: row.days ?? row.teamDays };
}

export async function setProjectRetention(projectId: number, days: number | null) {
  await db.update(project).set({ trashRetentionDays: days }).where(eq(project.id, projectId));
  return projectRetention(projectId);
}

async function policies(tx: Tx) {
  const teams = await tx.select().from(team).orderBy(asc(team.id)).for('share');
  const projects = await tx
    .select({
      id: project.id,
      key: project.key,
      teamId: project.teamId,
      days: project.trashRetentionDays,
    })
    .from(project)
    .orderBy(asc(project.id))
    .for('share');
  const [owner] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.role, 'god'))
    .orderBy(asc(user.createdAt))
    .limit(1);
  const [owned] = owner
    ? await tx
        .select({ teamId: teamMember.teamId })
        .from(teamMember)
        .where(and(eq(teamMember.userId, owner.id), eq(teamMember.role, 'owner')))
        .orderBy(asc(teamMember.teamId))
        .limit(1)
    : [];
  const homeTeamId = owned?.teamId ?? teams[0]?.id ?? null;
  return {
    forPath(relative: string) {
      const location = locateVaultPath(relative);
      const current = location.projectKey
        ? projects.find((item) => item.key === location.projectKey)
        : null;
      if (location.scope === 'project' && !current) return null;
      const teamId = current?.teamId ?? homeTeamId;
      const owningTeam = teams.find((item) => item.id === teamId);
      return {
        teamId,
        projectId: current?.id ?? null,
        days: current?.days ?? owningTeam?.trashRetentionDays ?? 30,
      };
    },
  };
}

export async function vaultRetentionDates(items: { path: string; trashedAt: Date }[]) {
  return db.transaction(async (tx) => {
    const policy = await policies(tx);
    const records = await listVaultTrashRecords();
    return items.map((item) => ({
      ...item,
      purgeAt: records.some(
        (record) =>
          !record.legacy &&
          record.original === item.path &&
          record.trashedAt === item.trashedAt.toISOString(),
      )
        ? purgeAt(item.trashedAt, policy.forPath(item.path)?.days ?? 0)
        : null,
    }));
  });
}

function matches(scope: TrashScope, entry: { teamId: number | null; projectId: number | null }) {
  return (
    (scope.teamId === undefined || entry.teamId === scope.teamId) &&
    (scope.projectId === undefined || entry.projectId === scope.projectId) &&
    (entry.projectId !== null || scope.includeHome !== false)
  );
}

function addCount(
  counts: TrashCounts[],
  kind: TrashKind,
  teamId: number | null,
  projectId: number | null,
) {
  const found = counts.find(
    (item) => item.kind === kind && item.teamId === teamId && item.projectId === projectId,
  );
  if (found) found.count++;
  else counts.push({ kind, teamId, projectId, count: 1 });
}

export async function emptyTrash(input: {
  scope?: TrashScope;
  kind?: TrashKind;
  dryRun?: boolean;
  now?: Date;
  automatic?: boolean;
  batchId?: string;
}) {
  const scope = input.scope ?? {};
  const now = input.now ?? new Date();
  const batchId = input.batchId ?? randomUUID();
  const trigger = input.automatic ? ('schedule' as const) : ('manual' as const);
  const counts: TrashCounts[] = [];
  if (!input.kind || input.kind === 'chat') {
    const rows = await db
      .select({
        id: agentChatThread.id,
        userId: agentChatThread.userId,
        projectId: agentChatThread.projectId,
        teamId: aiAgent.teamId,
        deletedAt: agentChatThread.deletedAt,
        days: sql<number>`coalesce(${project.trashRetentionDays}, ${team.trashRetentionDays})`,
      })
      .from(agentChatThread)
      .innerJoin(aiAgent, eq(aiAgent.id, agentChatThread.agentId))
      .innerJoin(team, eq(team.id, aiAgent.teamId))
      .leftJoin(project, eq(project.id, agentChatThread.projectId))
      .where(
        and(
          isNotNull(agentChatThread.deletedAt),
          scope.userId ? eq(agentChatThread.userId, scope.userId) : undefined,
          scope.teamId === undefined ? undefined : eq(aiAgent.teamId, scope.teamId),
          scope.projectId === undefined
            ? undefined
            : eq(agentChatThread.projectId, scope.projectId),
          sql`not exists (select 1 from ${agentChatMessage} where ${agentChatMessage.threadId} = ${agentChatThread.id} and ${agentChatMessage.status} in ('pending','streaming'))`,
        ),
      );
    for (const row of rows) {
      if (
        !matches(scope, row) ||
        (input.automatic &&
          (row.days === 0 || row.deletedAt!.getTime() >= now.getTime() - row.days * DAY_MS))
      )
        continue;
      if (
        input.dryRun ||
        (await deleteThread(row.id, row.userId, {
          trashOnly: true,
          retentionNow: input.automatic ? now : undefined,
          audit: { batchId, trigger },
        }))
      ) {
        addCount(counts, 'chat', row.teamId, row.projectId);
      }
    }
  }
  if (!input.kind || input.kind === 'vault') {
    await db.transaction(async (tx) => {
      const policy = await policies(tx);
      const select = (record: TrashRecord) => {
        const entry = policy.forPath(record.original);
        return (
          !!entry &&
          matches(scope, entry) &&
          (!input.automatic ||
            (!record.legacy &&
              entry.days > 0 &&
              Date.parse(record.trashedAt) < now.getTime() - entry.days * DAY_MS))
        );
      };
      const preview = await purgeVaultTrash({ olderThanDays: 0, now, select });
      if (input.dryRun) {
        for (const record of await listVaultTrashRecords())
          if (preview.targets.includes(record.target)) {
            const entry = policy.forPath(record.original)!;
            addCount(counts, 'vault', entry.teamId, entry.projectId);
          }
      } else {
        await purgeVaultTrash({
          olderThanDays: 0,
          now,
          select,
          apply: true,
          confirmTargets: preview.targets,
          onPurge: async (record) => {
            const entry = policy.forPath(record.original)!;
            const saved = await db
              .insert(volitionTrashPurge)
              .values({
                id: `vault:${record.recordPath}`,
                batchId,
                kind: 'vault',
                trigger,
                teamId: entry.teamId,
                projectId: entry.projectId,
              })
              .onConflictDoNothing()
              .returning({ id: volitionTrashPurge.id });
            if (saved.length) addCount(counts, 'vault', entry.teamId, entry.projectId);
          },
        });
      }
    });
  }
  return {
    dryRun: input.dryRun === true,
    counts,
    count: counts.reduce((sum, row) => sum + row.count, 0),
  };
}

export async function trashHistory(scope: TrashScope, limit = 50) {
  const rows = await db
    .select({
      batchId: volitionTrashPurge.batchId,
      kind: volitionTrashPurge.kind,
      teamId: volitionTrashPurge.teamId,
      projectId: volitionTrashPurge.projectId,
      trigger: volitionTrashPurge.trigger,
      count: sql<number>`count(*)::int`,
      at: sql<string>`max(${volitionTrashPurge.createdAt})::text`,
    })
    .from(volitionTrashPurge)
    .where(
      and(
        scope.teamId === undefined ? undefined : eq(volitionTrashPurge.teamId, scope.teamId),
        scope.projectId === undefined
          ? undefined
          : eq(volitionTrashPurge.projectId, scope.projectId),
      ),
    )
    .groupBy(
      volitionTrashPurge.batchId,
      volitionTrashPurge.kind,
      volitionTrashPurge.teamId,
      volitionTrashPurge.projectId,
      volitionTrashPurge.trigger,
    )
    .orderBy(sql`max(${volitionTrashPurge.createdAt}) desc`)
    .limit(limit);
  return rows.map((row) => ({ ...row, at: new Date(row.at).toISOString() }));
}

export async function purgeActivityEntries(
  projectIds: number[],
  userId: string,
  cursor: { at: string; id: string } | null,
  limit: number,
  includeHome: boolean,
) {
  const rows = await db.execute(sql`
    with purges as (
      select 'trash:' || t.batch_id || ':' || coalesce(t.project_id::text, 'home') || ':' || coalesce(t.team_id::text, 'none') as id,
        date_trunc('milliseconds', max(t.created_at)) as at,
        p.id as "projectId", p.key as "projectKey", p.name as "projectName", t.trigger,
        count(*) filter (where t.kind = 'chat')::int as chat,
        count(*) filter (where t.kind = 'vault')::int as vault
      from volition_trash_purge t left join project p on p.id = t.project_id
      where (${
        projectIds.length
          ? sql`t.project_id in (${sql.join(
              projectIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : sql`false`
      } or
        (t.project_id is null and ${includeHome} and exists (select 1 from team_member m where m.team_id = t.team_id
          and m.user_id = ${userId} and m.role in ('owner','manager'))))
      group by t.batch_id, t.team_id, t.project_id, p.id, t.trigger
    ) select *, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as iso
      from purges ${cursor ? sql`where (at < ${cursor.at}::timestamptz or (at = ${cursor.at}::timestamptz and id collate "C" < ${cursor.id} collate "C"))` : sql``}
      order by at desc, id collate "C" desc limit ${limit}
  `);
  return (
    rows as unknown as {
      id: string;
      iso: string;
      projectId: number | null;
      projectKey: string | null;
      projectName: string | null;
      trigger: string;
      chat: number;
      vault: number;
    }[]
  ).map((row) => ({
    id: row.id,
    at: row.iso,
    trigger: row.trigger,
    trashCounts: { chat: row.chat, vault: row.vault },
    project:
      row.projectId === null
        ? null
        : { id: row.projectId, key: row.projectKey!, name: row.projectName! },
  }));
}

export async function purgeVaultTrashAudited(input: {
  olderThanDays: number;
  apply?: boolean;
  confirmTargets?: string[];
}) {
  return db.transaction(async (tx) => {
    const policy = await policies(tx);
    const batchId = randomUUID();
    return purgeVaultTrash({
      ...input,
      onPurge: async (record) => {
        const entry = policy.forPath(record.original);
        await db
          .insert(volitionTrashPurge)
          .values({
            id: `vault:${record.recordPath}`,
            batchId,
            kind: 'vault',
            trigger: 'manual',
            teamId: entry?.teamId ?? null,
            projectId: entry?.projectId ?? null,
          })
          .onConflictDoNothing();
      },
    });
  });
}
