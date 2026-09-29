import { beforeEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, helenaBrowserTaskRun, project, vaultEntry } from '@repo/db';
import { vaultOrigin } from '@repo/vault';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { png } from '#tests/helpers/files';
import { freshVault } from '#tests/helpers/vault';
import { finishTask, hashToken } from '../../runs';
import { getLabRun } from '../../lab';
import { moveFramesToVault } from '../../frames';

// A browser run's last page is a file in the vault (Files/Browser), not a picture in the
// database; the frames runs kept there before move over in one run.

const dataUrl = (tail = '') => `data:image/png;base64,${png(tail).toString('base64')}`;

describe('final frames of browser runs', () => {
  let vault: string;
  let teamId: number;
  let projectId: number;

  beforeEach(async () => {
    await resetDb();
    vault = freshVault();
    const owner = await signUpTestUser();
    await authedApi(owner.cookie).projects.post({ key: 'MKT', name: 'Marketing' });
    const [row] = await db
      .select({ id: project.id, teamId: project.teamId })
      .from(project)
      .where(eq(project.key, 'MKT'));
    projectId = row!.id;
    teamId = row!.teamId;
  });

  async function openRun(token: string, scope: number | null) {
    const [run] = await db
      .insert(helenaBrowserTaskRun)
      .values({
        teamId,
        projectId: scope,
        source: 'lab',
        backend: 'jev-browser',
        goal: 'Seite prüfen',
        status: 'running',
        tokenHash: hashToken(token),
        tokenExpiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    return run!;
  }

  it('stores a finished run’s frame in the project’s Files/Browser', async () => {
    const token = 'frame-token-0123456789abcdef';
    const run = await openRun(token, projectId);
    await finishTask(token, { status: 'done', finalFrame: dataUrl() });

    const [row] = await db
      .select()
      .from(helenaBrowserTaskRun)
      .where(eq(helenaBrowserTaskRun.id, run.id));
    const expected = `Projects/MKT/Files/Browser/${run.id}.png`;
    expect(row!.status).toBe('done');
    expect(row!.finalFrame).toBeNull();
    expect(row!.finalFramePath).toBe(expected);
    expect(row!.finalFrameSha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await readFile(path.join(vault, expected))).equals(png())).toBe(true);
    const [entry] = await db.select().from(vaultEntry).where(eq(vaultEntry.path, expected));
    expect(entry?.lastAuthor).toBe('system');
    expect(vaultOrigin(entry!)).toBe('agent');

    const view = await getLabRun({ teamId, project: { id: projectId, key: 'MKT' } }, run.id);
    expect(view.finalFramePath).toBe(expected);
    expect(view.finalFrame).toBeNull();
  });

  it('keeps no frame that is not a PNG or JPEG data URL', async () => {
    const token = 'frame-token-invalid-0123456789';
    const run = await openRun(token, projectId);
    await finishTask(token, { status: 'done', finalFrame: 'data:image/svg+xml;base64,PHN2Zz4=' });
    const [row] = await db
      .select()
      .from(helenaBrowserTaskRun)
      .where(eq(helenaBrowserTaskRun.id, run.id));
    expect(row!.finalFramePath).toBeNull();
    expect(row!.finalFrame).toBeNull();
    expect(existsSync(path.join(vault, 'Projects/MKT/Files/Browser'))).toBe(false);
  });

  it('moves the frames kept in the database into the vault, once', async () => {
    const [projectRun] = await db
      .insert(helenaBrowserTaskRun)
      .values({
        teamId,
        projectId,
        source: 'lab',
        backend: 'jev-browser',
        goal: 'Alt',
        status: 'done',
        finalFrame: dataUrl('project'),
      })
      .returning();
    const [homeRun] = await db
      .insert(helenaBrowserTaskRun)
      .values({
        teamId,
        projectId: null,
        source: 'lab',
        backend: 'jev-browser',
        goal: 'Alt Home',
        status: 'done',
        finalFrame: dataUrl('home').replace('image/png', 'image/jpeg'),
      })
      .returning();
    const [broken] = await db
      .insert(helenaBrowserTaskRun)
      .values({
        teamId,
        projectId,
        source: 'lab',
        backend: 'jev-browser',
        goal: 'Kaputt',
        status: 'done',
        finalFrame: 'data:text/plain;base64,aGFsbG8=',
      })
      .returning();

    const dry = await moveFramesToVault();
    expect(dry.pending.map((run) => run.id)).toEqual([projectRun!.id, homeRun!.id]);
    expect(dry.invalid).toEqual([{ id: broken!.id }]);
    expect(dry.migrated).toEqual([]);
    const [untouched] = await db
      .select()
      .from(helenaBrowserTaskRun)
      .where(eq(helenaBrowserTaskRun.id, projectRun!.id));
    expect(untouched!.finalFramePath).toBeNull();
    expect(untouched!.finalFrame).toBe(dataUrl('project'));

    const applied = await moveFramesToVault({ apply: true });
    expect(applied.failed).toEqual([]);
    expect(applied.migrated).toEqual([
      { id: projectRun!.id, path: `Projects/MKT/Files/Browser/${projectRun!.id}.png` },
      { id: homeRun!.id, path: `Home/Files/Browser/${homeRun!.id}.jpg` },
    ]);
    const stored = (relative: string) => readFile(path.join(vault, relative));
    expect(
      (await stored(`Projects/MKT/Files/Browser/${projectRun!.id}.png`)).equals(png('project')),
    ).toBe(true);
    expect((await stored(`Home/Files/Browser/${homeRun!.id}.jpg`)).equals(png('home'))).toBe(true);
    const rows = await db.select().from(helenaBrowserTaskRun).orderBy(helenaBrowserTaskRun.id);
    expect(rows.map((row) => [row.id, row.finalFramePath, row.finalFrame])).toEqual([
      [projectRun!.id, `Projects/MKT/Files/Browser/${projectRun!.id}.png`, null],
      [homeRun!.id, `Home/Files/Browser/${homeRun!.id}.jpg`, null],
      [broken!.id, null, 'data:text/plain;base64,aGFsbG8='],
    ]);

    const again = await moveFramesToVault({ apply: true });
    expect(again.pending).toEqual([]);
    expect(again.migrated).toEqual([]);
    expect(again.failed).toEqual([]);

    const home = await getLabRun({ teamId, project: null }, homeRun!.id);
    expect(home.finalFramePath).toBe(`Home/Files/Browser/${homeRun!.id}.jpg`);
  });
});
