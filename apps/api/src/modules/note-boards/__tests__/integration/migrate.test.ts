import { beforeEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, noteBoard, noteBoardMember, project, vaultEntry } from '@repo/db';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { freshVault } from '#tests/helpers/vault';
import { migrateBoardsToVault } from '../../migrate';

// Public boards that predate files move into the vault in one run; private and restricted
// boards stay in the database untouched.

const sticker = (id: string, title: string, body: string) => ({
  id,
  type: 'sticker',
  position: { x: 10, y: 20 },
  width: 260,
  height: 220,
  data: { title, body, color: '#D5F692' },
});

describe('note boards to the vault', () => {
  let vault: string;
  let projectId: number;
  let ownerId: string;
  let memberId: string;

  beforeEach(async () => {
    await resetDb();
    vault = freshVault();
    const owner = await signUpTestUser();
    const member = await signUpTestUser();
    ownerId = owner.userId;
    memberId = member.userId;
    await authedApi(owner.cookie).projects.post({ key: 'MKT', name: 'Marketing' });
    const [row] = await db.select({ id: project.id }).from(project).where(eq(project.key, 'MKT'));
    projectId = row!.id;
  });

  async function legacyBoards() {
    const canvas = { nodes: [sticker('a', 'Alt', 'Aus der **Datenbank**')], edges: [] };
    const [publicBoard] = await db
      .insert(noteBoard)
      .values({
        projectId,
        ownerUserId: null,
        createdByUserId: ownerId,
        name: 'Alt: Ideen',
        canvas,
      })
      .returning();
    const [privateBoard] = await db
      .insert(noteBoard)
      .values({ projectId, ownerUserId: ownerId, createdByUserId: ownerId, name: 'Privat', canvas })
      .returning();
    const [restricted] = await db
      .insert(noteBoard)
      .values({ projectId, ownerUserId: ownerId, createdByUserId: ownerId, name: 'Team', canvas })
      .returning();
    await db.insert(noteBoardMember).values({ boardId: restricted!.id, userId: memberId });
    return { publicBoard: publicBoard!, privateBoard: privateBoard!, restricted: restricted! };
  }

  it('reports without changing anything in a dry run', async () => {
    const { publicBoard, privateBoard, restricted } = await legacyBoards();
    const before = await db.select().from(noteBoard).orderBy(noteBoard.id);

    const report = await migrateBoardsToVault();

    expect(report.apply).toBe(false);
    expect(report.pending).toEqual([{ id: publicBoard.id, projectKey: 'MKT', name: 'Alt: Ideen' }]);
    expect(report.migrated).toEqual([]);
    expect(report.kept).toEqual([
      { id: privateBoard.id, projectKey: 'MKT', visibility: 'private' },
      { id: restricted.id, projectKey: 'MKT', visibility: 'restricted' },
    ]);
    expect(await db.select().from(noteBoard).orderBy(noteBoard.id)).toEqual(before);
    expect(existsSync(path.join(vault, 'Projects/MKT/Boards'))).toBe(false);
  });

  it('files the public board, empties its canvas and is idempotent', async () => {
    const { publicBoard, privateBoard, restricted } = await legacyBoards();
    const privateBefore = await db
      .select()
      .from(noteBoard)
      .where(eq(noteBoard.ownerUserId, ownerId))
      .orderBy(noteBoard.id);

    const first = await migrateBoardsToVault({ apply: true });
    expect(first.failed).toEqual([]);
    expect(first.migrated).toEqual([
      {
        id: publicBoard.id,
        projectKey: 'MKT',
        name: 'Alt: Ideen',
        vaultPath: 'Projects/MKT/Boards/Alt Ideen.canvas',
      },
    ]);

    const [filed] = await db.select().from(noteBoard).where(eq(noteBoard.id, publicBoard.id));
    expect(filed!.vaultPath).toBe('Projects/MKT/Boards/Alt Ideen.canvas');
    expect(filed!.vaultSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(filed!.canvas).toEqual({});
    expect(filed!.updatedAt).toEqual(publicBoard.updatedAt);
    const file = JSON.parse(
      await readFile(path.join(vault, 'Projects/MKT/Boards/Alt Ideen.canvas'), 'utf8'),
    ) as { nodes: Record<string, unknown>[] };
    expect(file.nodes[0]).toMatchObject({
      id: 'a',
      type: 'text',
      text: '# Alt\n\nAus der **Datenbank**',
    });
    const [entry] = await db
      .select({ lastAuthor: vaultEntry.lastAuthor })
      .from(vaultEntry)
      .where(eq(vaultEntry.path, 'Projects/MKT/Boards/Alt Ideen.canvas'));
    expect(entry?.lastAuthor).toBe('system');

    // Private and restricted boards keep their canvas in the database.
    expect(
      await db
        .select()
        .from(noteBoard)
        .where(eq(noteBoard.ownerUserId, ownerId))
        .orderBy(noteBoard.id),
    ).toEqual(privateBefore);
    expect(first.kept.map((board) => board.id)).toEqual([privateBoard.id, restricted.id]);

    const second = await migrateBoardsToVault({ apply: true });
    expect(second.pending).toEqual([]);
    expect(second.migrated).toEqual([]);
    expect(second.failed).toEqual([]);
    const [again] = await db.select().from(noteBoard).where(eq(noteBoard.id, publicBoard.id));
    expect(again).toEqual(filed);
  });
});
