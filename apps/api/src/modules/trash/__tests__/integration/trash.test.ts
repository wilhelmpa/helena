import { beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, access, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  agentChatFavorite,
  agentChatMessage,
  agentChatThread,
  agentChatUsage,
  db,
  helenaAgentSession,
  knowledgeChunk,
  knowledgeItem,
  teamMember,
  volitionTrashPurge,
  vaultEntry,
} from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';
import { indexVaultPaths, purgeVaultTrash, restoreVaultPath, trashVaultPath } from '@repo/vault';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { addProjectMember } from '#tests/helpers/members';
import { freshVault } from '#tests/helpers/vault';
import { deleteThread } from '#modules/agents/chat/service';
import {
  emptyTrash,
  DAY_MS,
  projectRetention,
  setProjectRetention,
  setTeamRetention,
  vaultRetentionDates,
} from '../../service';
import { TRASH_JOB_ID } from '../../job';
import { systemJob } from '#modules/engine/system-jobs';

const now = new Date('2026-09-30T12:00:00.000Z');
const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
let root: string;
beforeEach(async () => {
  await resetDb();
  root = freshVault();
});

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const a = (await api.projects.post({ key: 'TRASH', name: 'Trash' })).data!;
  const b = (await api.projects.post({ key: 'KEEP', name: 'Keep' })).data!;
  const agent = (
    await createAgent(api, a.key, {
      name: 'Trash agent',
      username: 'trash-agent',
      kind: 'external',
    })
  ).data!.agent;
  async function chat(
    projectId: number | null,
    deletedAt: Date | null,
    archived = false,
    live = false,
  ) {
    const id = randomUUID();
    await db.insert(agentChatThread).values({
      id,
      agentId: agent.id,
      userId: owner.userId,
      projectId,
      deletedAt,
      archivedAt: archived ? ago(100) : null,
    });
    const [message] = await db
      .insert(agentChatMessage)
      .values({
        threadId: id,
        agentId: agent.id,
        role: 'assistant',
        content: 'Test answer',
        status: live ? 'streaming' : 'success',
      })
      .returning();
    return { id, messageId: message!.id };
  }
  async function file(relative: string, days: number) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), 'Trash content');
    await indexVaultPaths([relative]);
    const target = await trashVaultPath(relative);
    const records = path.join(
      root,
      relative.startsWith('Private/') ? 'Private/.trash/.records' : '.trash/.records',
    );
    for (const name of await readdir(records)) {
      const recordPath = path.join(records, name);
      const record = JSON.parse(await readFile(recordPath, 'utf8'));
      if (record.target === target) {
        record.trashedAt = ago(days).toISOString();
        await writeFile(recordPath, JSON.stringify(record));
      }
    }
    return target;
  }
  return { api, a, b, agent, owner, chat, file };
}

async function indexItem(source: string, itemId: string, teamId: number, projectId: number) {
  const [item] = await db
    .insert(knowledgeItem)
    .values({
      source,
      itemId,
      teamId,
      projectId,
      visibility: 'project',
      title: 'Test',
      text: 'Test',
      href: '/test',
      contentHash: 'test',
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await db
    .insert(knowledgeChunk)
    .values({ itemId: item!.id, ordinal: 0, text: 'Test', contentHash: 'test', embedding: [1, 2] });
}

describe('trash retention', () => {
  it('defaults to 30 days, supports project inheritance and never deletes active, archived, recent or running chats', async () => {
    const ctx = await setup();
    expect(await projectRetention(ctx.a.id)).toEqual({ days: null, effectiveDays: 30 });
    const old = await ctx.chat(ctx.a.id, ago(31));
    const edge = await ctx.chat(ctx.a.id, ago(30));
    const active = await ctx.chat(ctx.a.id, null);
    const archived = await ctx.chat(ctx.a.id, null, true);
    const running = await ctx.chat(ctx.a.id, ago(100), false, true);
    await setProjectRetention(ctx.b.id, 0);
    const kept = await ctx.chat(ctx.b.id, ago(100));
    const dry = await emptyTrash({ automatic: true, now, dryRun: true });
    expect(dry.count).toBe(1);
    expect(await db.select().from(volitionTrashPurge)).toHaveLength(0);
    expect(await db.select().from(agentChatThread)).toHaveLength(6);
    expect((await emptyTrash({ automatic: true, now })).count).toBe(1);
    const ids = (await db.select().from(agentChatThread)).map((row) => row.id);
    expect(ids).not.toContain(old.id);
    for (const entry of [edge, active, archived, running, kept]) expect(ids).toContain(entry.id);
    expect((await emptyTrash({ automatic: true, now })).count).toBe(0);
    expect(await db.select().from(volitionTrashPurge)).toHaveLength(1);
  });

  it('honors zero at team level, shorter project overrides, inherited changes and API purge dates', async () => {
    const ctx = await setup();
    await setTeamRetention(ctx.a.teamId, 0);
    await setProjectRetention(ctx.a.id, 5);
    const removed = await ctx.chat(ctx.a.id, ago(6));
    const kept = await ctx.chat(ctx.b.id, ago(100));
    const home = await ctx.chat(null, ago(100));
    const list = await ctx.api.chats.get({ query: { view: 'trash' } });
    expect(
      new Date(list.data!.items.find((item) => item.id === removed.id)!.purgeAt!).toISOString(),
    ).toBe(ago(1).toISOString());
    expect(list.data!.items.find((item) => item.id === kept.id)!.purgeAt).toBeNull();
    expect(list.data!.items.find((item) => item.id === home.id)!.purgeAt).toBeNull();
    expect((await emptyTrash({ automatic: true, now })).count).toBe(1);
    await setProjectRetention(ctx.a.id, null);
    await setTeamRetention(ctx.a.teamId, 10);
    expect(await projectRetention(ctx.a.id)).toEqual({ days: null, effectiveDays: 10 });
  });

  it('removes messages, usage, favorites, native transcripts and vectors atomically while keeping shared Vault attachments', async () => {
    const ctx = await setup();
    const old = await ctx.chat(ctx.a.id, ago(40));
    const shared = 'Projects/TRASH/Files/shared.txt';
    await mkdir(path.dirname(path.join(root, shared)), { recursive: true });
    await writeFile(path.join(root, shared), 'Shared file');
    await db
      .update(agentChatMessage)
      .set({
        attachments: [
          {
            kind: 'file',
            path: shared,
            name: 'shared.txt',
            contentType: 'text/plain',
            sizeBytes: 11,
          },
        ],
      })
      .where(eq(agentChatMessage.id, old.messageId));
    await db
      .insert(agentChatFavorite)
      .values({ threadId: old.id, agentId: ctx.agent.id, userId: ctx.owner.userId });
    await db.insert(agentChatUsage).values({ threadId: old.id, agentId: ctx.agent.id });
    await db.insert(helenaAgentSession).values({
      agentId: ctx.agent.id,
      teamId: ctx.a.teamId,
      projectId: ctx.a.id,
      kind: 'chat',
      chatThreadId: old.id,
    });
    await indexItem('chat', String(old.messageId), ctx.a.teamId, ctx.a.id);
    await db.execute(
      sql`create function volition_test_purge_abort() returns trigger language plpgsql as $$begin raise exception 'Injected transaction abort'; end$$`,
    );
    await db.execute(
      sql`create trigger volition_test_purge_abort before insert on volition_trash_purge for each row execute function volition_test_purge_abort()`,
    );
    try {
      await expect(emptyTrash({ automatic: true, now })).rejects.toThrow();
      expect(await db.select().from(agentChatMessage)).toHaveLength(1);
      expect(await db.select().from(agentChatUsage)).toHaveLength(1);
      expect(await db.select().from(knowledgeChunk)).toHaveLength(1);
    } finally {
      await db.execute(sql`drop trigger volition_test_purge_abort on volition_trash_purge`);
      await db.execute(sql`drop function volition_test_purge_abort()`);
    }
    await emptyTrash({ automatic: true, now });
    for (const table of [
      agentChatMessage,
      agentChatFavorite,
      agentChatUsage,
      helenaAgentSession,
      knowledgeItem,
      knowledgeChunk,
    ])
      expect(await db.select().from(table)).toHaveLength(0);
    expect(await readFile(path.join(root, shared), 'utf8')).toBe('Shared file');
  });

  it('purges Vault bytes and vectors, preserves fresh trash and recreated originals, and supports repeat runs', async () => {
    const ctx = await setup();
    await setProjectRetention(ctx.a.id, 5);
    const original = 'Projects/TRASH/Docs/old.md';
    const old = await ctx.file(original, 6);
    const recent = await ctx.file('Projects/TRASH/Docs/recent.md', 1);
    const kept = await ctx.file('Projects/KEEP/Docs/kept.md', 20);
    const recreated = 'Projects/TRASH/Docs/recreated.md';
    const discarded = await ctx.file(recreated, 6);
    await writeFile(path.join(root, recreated), 'Active copy');
    await indexVaultPaths([recreated]);
    await indexItem('vault', original, ctx.a.teamId, ctx.a.id);
    const dates = await vaultRetentionDates([{ path: original, trashedAt: ago(6) }]);
    expect(dates[0]!.purgeAt).toBe(ago(1).toISOString());
    expect((await emptyTrash({ automatic: true, now, dryRun: true })).count).toBe(2);
    await access(path.join(root, old));
    expect((await emptyTrash({ automatic: true, now })).count).toBe(2);
    await expect(access(path.join(root, old))).rejects.toThrow();
    await expect(access(path.join(root, discarded))).rejects.toThrow();
    await access(path.join(root, recent));
    await access(path.join(root, kept));
    expect(await readFile(path.join(root, recreated), 'utf8')).toBe('Active copy');
    expect((await db.select().from(vaultEntry).where(eq(vaultEntry.path, recreated))).length).toBe(
      1,
    );
    expect(await db.select().from(knowledgeChunk)).toHaveLength(0);
    expect((await emptyTrash({ automatic: true, now })).count).toBe(0);
    const history = await ctx.api
      .projects({ projectKey: ctx.a.key })
      ['trash-activity'].get({ query: {} });
    expect(history.data![0]!.count).toBe(2);
    const activity = await ctx.api
      .projects({ projectKey: ctx.a.key })
      ['agent-activity'].get({ query: {} });
    expect(
      activity.data!.items.find((item) => item.workflowId === TRASH_JOB_ID)!.trashCounts,
    ).toEqual({ chat: 0, vault: 2 });
  });

  it('can resume after a Vault cleanup failure and serializes restore against purge', async () => {
    const ctx = await setup();
    const original = 'Projects/TRASH/Docs/interrupted.md';
    const target = await ctx.file(original, 40);
    await expect(
      purgeVaultTrash({
        olderThanDays: 30,
        now,
        apply: true,
        confirmTargets: [target],
        onPurge: async () => {
          throw new Error('Injected abort');
        },
      }),
    ).rejects.toThrow('Injected abort');
    expect((await purgeVaultTrash({ olderThanDays: 30, now })).targets).toEqual([target]);
    expect((await emptyTrash({ automatic: true, now })).count).toBe(1);
    expect((await purgeVaultTrash({ olderThanDays: 30, now })).targets).toEqual([]);
    const restored = 'Projects/TRASH/Docs/restored.md';
    await ctx.file(restored, 40);
    await restoreVaultPath(restored);
    expect((await emptyTrash({ automatic: true, now })).count).toBe(0);
    expect(await readFile(path.join(root, restored), 'utf8')).toBe('Trash content');
    const racing = 'Projects/TRASH/Docs/racing.md';
    const racingTarget = await ctx.file(racing, 40);
    let resume!: () => void;
    let entered!: () => void;
    const wait = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const deleting = purgeVaultTrash({
      olderThanDays: 30,
      now,
      apply: true,
      confirmTargets: [racingTarget],
      onPurge: async () => {
        entered();
        await wait;
      },
    });
    await started;
    const restoring = restoreVaultPath(racing).then(
      () => true,
      () => false,
    );
    resume();
    await deleting;
    expect(await restoring).toBe(false);
    await expect(access(path.join(root, racing))).rejects.toThrow();
  });

  it('checks the current trash marker and policy again before deletion', async () => {
    const ctx = await setup();
    const restored = await ctx.chat(ctx.a.id, ago(50));
    await db
      .update(agentChatThread)
      .set({ deletedAt: null })
      .where(eq(agentChatThread.id, restored.id));
    expect(await deleteThread(restored.id, ctx.owner.userId, { trashOnly: true })).toBe(false);
    await db
      .update(agentChatThread)
      .set({ deletedAt: ago(50) })
      .where(eq(agentChatThread.id, restored.id));
    await setTeamRetention(ctx.a.teamId, 0);
    expect(
      await deleteThread(restored.id, ctx.owner.userId, { trashOnly: true, retentionNow: now }),
    ).toBe(false);
  });

  it('restricts APIs to owners and managers, requires confirmation, and scopes manual purges', async () => {
    const ctx = await setup();
    const member = await addProjectMember(ctx.api, ctx.a.key);
    const otherTeam = (await ctx.api.teams.post({ name: 'Other team' })).data!;
    const foreign = (
      await ctx.api
        .teams({ teamId: otherTeam.id })
        .projects.post({ key: 'FOREIGN', name: 'Foreign' })
    ).data!;
    const ownTrash = await ctx.chat(ctx.a.id, ago(1));
    const members = await db.select().from(teamMember).where(eq(teamMember.teamId, ctx.a.teamId));
    const memberId = members.find((item) => item.role === 'member')!.userId;
    await db
      .update(agentChatThread)
      .set({ userId: memberId })
      .where(eq(agentChatThread.id, ownTrash.id));
    const foreignAgent = (
      await createAgent(ctx.api, foreign.key, {
        name: 'Other agent',
        username: 'other-agent',
        kind: 'external',
      })
    ).data!.agent;
    await db.insert(agentChatThread).values({
      id: randomUUID(),
      agentId: foreignAgent.id,
      userId: ctx.owner.userId,
      projectId: foreign.id,
      deletedAt: ago(100),
    });
    expect(
      (await member.teams({ teamId: ctx.a.teamId })['trash-retention'].put({ days: 1 })).status,
    ).toBe(403);
    expect(
      (
        await member
          .projects({ projectKey: ctx.a.key })
          .trash({ kind: 'chat' })
          .empty.post({ confirmed: true })
      ).status,
    ).toBe(403);
    expect((await member.chats['empty-trash'].post({ confirmed: true })).status).toBe(403);
    expect(
      (
        await member
          .chats({ threadId: ownTrash.id })
          .delete(undefined, { query: { permanent: true } })
      ).status,
    ).toBe(403);
    expect(
      (await ctx.api.teams({ teamId: ctx.a.teamId })['trash-retention'].put({ days: -1 })).status,
    ).toBe(400);
    const unconfirmed = await app.handle(
      new Request(`http://127.0.0.1/projects/${ctx.a.key}/trash/chat/empty`, {
        method: 'POST',
        headers: { cookie: ctx.owner.cookie, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(unconfirmed.status).toBe(400);
    const manual = await ctx.api
      .projects({ projectKey: ctx.a.key })
      .trash({ kind: 'chat' })
      .empty.post({ confirmed: true });
    expect(manual.data!.count).toBe(1);
    expect(await db.select().from(agentChatThread)).toHaveLength(1);
    expect((await systemJob(TRASH_JOB_ID)!.schedule()).cron).toBe('30 3 * * *');
    expect(
      (await ctx.api.projects({ projectKey: ctx.a.key })['trash-retention'].put({ days: null }))
        .data!.effectiveDays,
    ).toBe(30);
    await db
      .update(teamMember)
      .set({ role: 'manager' })
      .where(and(eq(teamMember.userId, memberId), eq(teamMember.teamId, ctx.a.teamId)));
    expect(
      (await member.teams({ teamId: ctx.a.teamId })['trash-retention'].put({ days: 15 })).status,
    ).toBe(200);
    expect(
      (await member.projects({ projectKey: ctx.a.key })['trash-retention'].put({ days: 3 })).status,
    ).toBe(200);
    expect(
      (
        await member
          .projects({ projectKey: ctx.a.key })
          .trash({ kind: 'vault' })
          .empty.post({ confirmed: true })
      ).status,
    ).toBe(200);
  });

  it('applies the team policy to Home and Private while the team empty endpoint only empties project Vault trash', async () => {
    const ctx = await setup();
    await setTeamRetention(ctx.a.teamId, 0);
    const home = await ctx.file('Home/Docs/old.md', 40);
    const privatePath = await ctx.file('Private/old.md', 40);
    const projectPath = await ctx.file('Projects/TRASH/Docs/old.md', 40);
    const manual = await ctx.api
      .teams({ teamId: ctx.a.teamId })
      .trash({ kind: 'vault' })
      .empty.post({ confirmed: true });
    expect(manual.data!.count).toBe(1);
    await expect(access(path.join(root, projectPath))).rejects.toThrow();
    await access(path.join(root, home));
    await access(path.join(root, privatePath));
    expect((await emptyTrash({ automatic: true, now })).count).toBe(0);
    await setTeamRetention(ctx.a.teamId, 30);
    expect((await emptyTrash({ automatic: true, now })).counts).toEqual([
      { teamId: ctx.a.teamId, projectId: null, kind: 'vault', count: 2 },
    ]);
    await expect(access(path.join(root, home))).rejects.toThrow();
    await expect(access(path.join(root, privatePath))).rejects.toThrow();
    const feed = await ctx.api
      .projects({ projectKey: ctx.a.key })
      ['agent-activity'].get({ query: {} });
    const purges = feed.data!.items.filter((item) => item.workflowId === TRASH_JOB_ID);
    expect(purges.reduce((count, item) => count + item.trashCounts!.vault, 0)).toBe(1);
  });

  it('leaves legacy Vault trash for a confirmed manual purge', async () => {
    const ctx = await setup();
    const legacy = path.join(root, '.trash/Projects/TRASH/Docs/legacy.md');
    await mkdir(path.dirname(legacy), { recursive: true });
    await writeFile(legacy, 'Legacy');
    expect((await emptyTrash({ automatic: true, now })).count).toBe(0);
    expect(
      (
        await vaultRetentionDates([
          { path: 'Projects/TRASH/Docs/legacy.md', trashedAt: (await stat(legacy)).ctime },
        ])
      )[0]!.purgeAt,
    ).toBeNull();
    expect((await emptyTrash({ scope: { projectId: ctx.a.id }, kind: 'vault' })).count).toBe(1);
    await expect(access(legacy)).rejects.toThrow();
  });
});
