import { beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { db, issueAttachment } from '@repo/db';
import { eq } from 'drizzle-orm';
import { putObject } from '#shared/s3';
import { api, app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';
import { png, pngFile, PNG_SIZE } from '#tests/helpers/files';
import { freshVault } from '#tests/helpers/vault';
import { moveAttachmentsToVault } from '../../vault-migration';

// Issue attachments stored in the project's vault folder: where they are written, how
// they follow a move, what happens when their file is gone, and the one-time move of
// the attachments still in the object store.

let vault: string;

beforeEach(async () => {
  await resetDb();
  vault = freshVault();
});

async function setupIssue() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = await asOwner.projects({ projectKey: 'MKT' }).get();
  const issue = await asOwner
    .projects({ projectKey: 'MKT' })
    .issues.post({ columnId: view.data!.columns[0].id, title: 'Task' });
  return {
    owner,
    asOwner,
    issueId: issue.data!.id,
    taskFolder: `Projects/MKT/Files/Tasks/${issue.data!.identifier}`,
    files: asOwner.projects({ projectKey: 'MKT' }).files,
  };
}

const upload = (client: ReturnType<typeof authedApi>, issueId: number, name: string, body = 'x') =>
  client
    .issues({ issueId })
    .attachments.post({ file: new File([body], name, { type: 'text/plain' }) });

const onDisk = (vaultPath: string) => path.join(vault, vaultPath);

describe('attachments in the vault', () => {
  it("stores an upload as the only copy in the issue's task folder", async () => {
    const { asOwner, issueId, taskFolder } = await setupIssue();
    const first = await upload(asOwner, issueId, 'Rechnung.txt', 'one');
    const second = await upload(asOwner, issueId, 'Rechnung.txt', 'two');
    expect(first.data).toMatchObject({
      filename: 'Rechnung.txt',
      vaultPath: `${taskFolder}/Rechnung.txt`,
      linked: false,
      missing: false,
    });
    expect(second.data!.vaultPath).toBe(`${taskFolder}/Rechnung (2).txt`);
    expect(readFileSync(onDisk(second.data!.vaultPath!), 'utf8')).toBe('two');
    const raw = await api.attachments({ publicId: first.data!.id }).raw.get();
    expect(String(raw.data)).toBe('one');
  });

  it('moves the file of a deleted attachment to the vault trash', async () => {
    const { asOwner, issueId, taskFolder } = await setupIssue();
    const up = await upload(asOwner, issueId, 'scan.txt', 'scan');
    expect((await asOwner.attachments({ publicId: up.data!.id }).delete()).status).toBe(204);
    expect(existsSync(onDisk(`${taskFolder}/scan.txt`))).toBe(false);
    expect(readFileSync(onDisk(`.trash/${taskFolder}/scan.txt`), 'utf8')).toBe('scan');
  });

  it('moves the files of a deleted issue to the vault trash', async () => {
    const { asOwner, issueId, taskFolder } = await setupIssue();
    await upload(asOwner, issueId, 'a.txt');
    expect((await asOwner.issues({ issueId }).delete()).status).toBe(204);
    expect(existsSync(onDisk(`.trash/${taskFolder}/a.txt`))).toBe(true);
    expect(existsSync(onDisk(taskFolder))).toBe(false);
  });

  it('replaces a file in place and keeps the previous version in the trash', async () => {
    const { asOwner, issueId, taskFolder } = await setupIssue();
    const up = await asOwner
      .issues({ issueId })
      .attachments.post({ file: pngFile('shot.png', 'before') });
    const replaced = await asOwner
      .attachments({ publicId: up.data!.id })
      .put({ file: pngFile('shot.png', 'after') });
    expect(replaced.data).toMatchObject({
      vaultPath: `${taskFolder}/shot.png`,
      sizeBytes: PNG_SIZE + 5,
    });
    expect(readFileSync(onDisk(`${taskFolder}/shot.png`)).equals(png('after'))).toBe(true);
    expect(readFileSync(onDisk(`.trash/${taskFolder}/shot.png`)).equals(png('before'))).toBe(true);
  });

  it('links a project file without copying it and leaves it when unlinked', async () => {
    const { asOwner, issueId, files } = await setupIssue();
    await files.upload.post(
      { files: [new File(['%PDF'], 'Vertrag.pdf', { type: 'application/pdf' })] },
      { query: { path: 'Verträge' } },
    );
    const linked = await asOwner
      .issues({ issueId })
      .attachments.link.post({ path: 'Verträge/Vertrag.pdf' });
    expect(linked.status).toBe(201);
    expect(linked.data).toMatchObject({
      filename: 'Vertrag.pdf',
      contentType: 'application/pdf',
      vaultPath: 'Projects/MKT/Verträge/Vertrag.pdf',
      linked: true,
    });

    expect((await asOwner.attachments({ publicId: linked.data!.id }).delete()).status).toBe(204);
    expect(existsSync(onDisk('Projects/MKT/Verträge/Vertrag.pdf'))).toBe(true);
  });

  it('refuses to link what is not a file of the project folder', async () => {
    const { asOwner, issueId, files } = await setupIssue();
    await files.folders.post({ path: 'Ordner' });
    const link = (p: string) => asOwner.issues({ issueId }).attachments.link.post({ path: p });
    expect((await link('missing.pdf')).status).toBe(404);
    expect((await link('Ordner')).status).toBe(400);
    expect((await link('../OTHER/x.pdf')).status).toBe(400);
  });

  it('needs the documents permission to link a file', async () => {
    const { asOwner, issueId, files } = await setupIssue();
    await files.upload.post({ files: [new File(['x'], 'x.txt')] });
    const role = await createRole(asOwner, 'MKT', {
      name: 'Tasks only',
      permissions: { work_items: { read: true, create: true, edit: true } },
    });
    const member = await addProjectMember(asOwner, 'MKT', role.data!.id);
    const res = await member.issues({ issueId }).attachments.link.post({ path: 'x.txt' });
    expect(res.status).toBe(403);
  });

  it('follows a file moved on the Files page', async () => {
    const { asOwner, issueId, taskFolder, files } = await setupIssue();
    await upload(asOwner, issueId, 'plan.txt');
    await files.folders.post({ path: 'Archiv' });
    const relative = taskFolder.replace('Projects/MKT/', '');
    await files.move.post({ from: relative, to: 'Archiv/Aufgabe' });
    const [attachment] = (await asOwner.issues({ issueId }).attachments.get()).data!;
    expect(attachment).toMatchObject({ vaultPath: 'Projects/MKT/Archiv/Aufgabe/plan.txt' });
  });

  it('finds a file moved outside Plan by its content', async () => {
    const { asOwner, issueId, taskFolder } = await setupIssue();
    await upload(asOwner, issueId, 'invoice.txt', 'unique content');
    mkdirSync(onDisk('Projects/MKT/Buchhaltung'));
    renameSync(onDisk(`${taskFolder}/invoice.txt`), onDisk('Projects/MKT/Buchhaltung/2026.txt'));

    const [attachment] = (await asOwner.issues({ issueId }).attachments.get()).data!;
    expect(attachment).toMatchObject({
      vaultPath: 'Projects/MKT/Buchhaltung/2026.txt',
      missing: false,
    });
    const raw = await api.attachments({ publicId: attachment.id }).raw.get();
    expect(String(raw.data)).toBe('unique content');
  });

  it('reports a missing file and points the attachment at another one', async () => {
    const { asOwner, issueId, taskFolder, files } = await setupIssue();
    const up = await upload(asOwner, issueId, 'gone.txt', 'gone');
    rmSync(onDisk(`${taskFolder}/gone.txt`));

    const [missing] = (await asOwner.issues({ issueId }).attachments.get()).data!;
    expect(missing).toMatchObject({ missing: true });
    expect((await api.attachments({ publicId: up.data!.id }).raw.get()).status).toBe(404);

    await files.upload.post({ files: [new File(['found'], 'found.txt')] });
    const relinked = await asOwner
      .attachments({ publicId: up.data!.id })
      .link.put({ path: 'found.txt' });
    expect(relinked.data).toMatchObject({
      vaultPath: 'Projects/MKT/found.txt',
      linked: true,
      missing: false,
    });
  });

  it('opens a PDF inline for a member and never on the public route', async () => {
    const { owner, asOwner, issueId } = await setupIssue();
    const up = await asOwner.issues({ issueId }).attachments.post({
      file: new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' }),
    });
    const view = await app.handle(
      new Request(`http://localhost/attachments/${up.data!.id}/view`, {
        headers: { cookie: owner.cookie },
      }),
    );
    expect(view.headers.get('content-disposition')).toStartWith('inline;');
    const pub = await api.attachments({ publicId: up.data!.id }).raw.get();
    expect(pub.response.headers.get('content-disposition')).toStartWith('attachment;');
    const anonymous = await app.handle(
      new Request(`http://localhost/attachments/${up.data!.id}/view`),
    );
    expect(anonymous.status).toBe(401);
  });
});

describe('moving the object-store attachments into the vault', () => {
  async function legacyAttachment(issueId: number, filename: string, body: string) {
    const key = `projects/1/attachments/${issueId}/${crypto.randomUUID()}-${filename}`;
    await putObject(key, Buffer.from(body), 'text/plain');
    const [row] = await db
      .insert(issueAttachment)
      .values({ issueId, s3Key: key, filename, contentType: 'text/plain', sizeBytes: body.length })
      .returning();
    return row;
  }

  it('counts, moves, and leaves nothing for a second run', async () => {
    const { asOwner, issueId, taskFolder } = await setupIssue();
    const row = await legacyAttachment(issueId, 'alt.txt', 'legacy');

    expect(await moveAttachmentsToVault({ dryRun: true })).toMatchObject({
      pending: 1,
      pendingBytes: 6,
      moved: [],
    });
    const receipt = await moveAttachmentsToVault();
    expect(receipt.moved).toEqual([
      {
        id: row.id,
        publicId: row.publicId,
        from: row.s3Key!,
        to: `${taskFolder}/alt.txt`,
        sha256: expect.any(String),
      },
    ]);
    expect(readFileSync(onDisk(`${taskFolder}/alt.txt`), 'utf8')).toBe('legacy');
    const [attachment] = (await asOwner.issues({ issueId }).attachments.get()).data!;
    expect(attachment.vaultPath).toBe(`${taskFolder}/alt.txt`);
    expect(String((await api.attachments({ publicId: row.publicId }).raw.get()).data)).toBe(
      'legacy',
    );

    expect((await moveAttachmentsToVault()).pending).toBe(0);
  });

  it('reuses the file an interrupted run wrote', async () => {
    const { issueId, taskFolder } = await setupIssue();
    const row = await legacyAttachment(issueId, 'alt.txt', 'legacy');
    mkdirSync(onDisk(taskFolder), { recursive: true });
    await Bun.write(onDisk(`${taskFolder}/alt.txt`), 'legacy');

    const receipt = await moveAttachmentsToVault();
    expect(receipt.moved[0].to).toBe(`${taskFolder}/alt.txt`);
    expect(existsSync(onDisk(`${taskFolder}/alt (2).txt`))).toBe(false);
    const [stored] = await db.select().from(issueAttachment).where(eq(issueAttachment.id, row.id));
    expect(stored.s3Key).toBeNull();
  });

  it('keeps a row whose object is gone for the next run', async () => {
    const { issueId } = await setupIssue();
    const [row] = await db
      .insert(issueAttachment)
      .values({
        issueId,
        s3Key: 'projects/1/attachments/none.txt',
        filename: 'none.txt',
        contentType: 'text/plain',
        sizeBytes: 1,
      })
      .returning();
    const receipt = await moveAttachmentsToVault();
    expect(receipt.failed).toMatchObject([{ id: row.id }]);
    expect((await moveAttachmentsToVault({ dryRun: true })).pending).toBe(1);
  });
});
