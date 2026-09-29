import { beforeEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import {
  agentChatMessage,
  agentChatThread,
  chatAttachment,
  db,
  project,
  vaultEntry,
} from '@repo/db';
import { indexVaultPaths, resolveVaultPath } from '@repo/vault';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import { freshVault } from '#tests/helpers/vault';
import { CHAT_FILES_FOLDER, moveChatFilesToFolder } from '../../folder';

// Chat files from the two old folders (the composer's "Chat Uploads" and the API's
// "Files/Chat Attachments") move into the one Files/Chat of their root, with every
// reference following them.

describe('chat files in one folder', () => {
  let vault: string;
  let projectId: number;
  let messageId: number;
  let homeMessageId: number;
  let attachmentId: number;

  async function put(relative: string, content: string) {
    await mkdir(path.dirname(path.join(vault, relative)), { recursive: true });
    await writeFile(path.join(vault, relative), content);
  }

  beforeEach(async () => {
    await resetDb();
    vault = freshVault();
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    await api.projects.post({ key: 'MKT', name: 'Marketing' });
    const [row] = await db.select({ id: project.id }).from(project).where(eq(project.key, 'MKT'));
    projectId = row!.id;
    const agent = (await createAgent(api, 'MKT', { name: 'Helper', username: 'helper' })).data!
      .agent;

    await put('Projects/MKT/Chat Uploads/Plan.pdf', 'upload');
    await put('Projects/MKT/Chat Uploads/Tiefer/Notiz.md', '# Notiz');
    await put('Projects/MKT/Files/Chat Attachments/Plan.pdf', 'attachment');
    await put('Projects/MKT/Files/Chat/Plan.pdf', 'already there');
    await put('Home/Chat Uploads/Bild.png', 'home');
    await indexVaultPaths(['Projects/MKT', 'Home']);

    const [attachment] = await db
      .insert(chatAttachment)
      .values({
        projectId,
        filename: 'Plan.pdf',
        contentType: 'application/pdf',
        sizeBytes: 10,
        vaultPath: 'Projects/MKT/Files/Chat Attachments/Plan.pdf',
      })
      .returning();
    attachmentId = attachment!.id;
    await db.insert(agentChatThread).values([
      { id: 'mkt-thread', agentId: agent.id, userId: owner.userId, projectId },
      { id: 'home-thread', agentId: agent.id, userId: owner.userId, projectId: null },
    ]);
    const [message] = await db
      .insert(agentChatMessage)
      .values({
        threadId: 'mkt-thread',
        agentId: agent.id,
        role: 'user',
        content: 'Schau dir das an',
        attachments: [
          { kind: 'file', path: 'Projects/MKT/Chat Uploads/Plan.pdf', name: 'Plan.pdf' },
          { kind: 'issue', key: 'MKT-1' },
        ],
      })
      .returning();
    messageId = message!.id;
    const [homeMessage] = await db
      .insert(agentChatMessage)
      .values({
        threadId: 'home-thread',
        agentId: agent.id,
        role: 'user',
        content: 'Bild',
        attachments: [{ kind: 'file', path: 'Home/Chat Uploads/Bild.png', name: 'Bild.png' }],
      })
      .returning();
    homeMessageId = homeMessage!.id;
  });

  it('plans the moves without changing anything in a dry run', async () => {
    const report = await moveChatFilesToFolder();
    expect(report.apply).toBe(false);
    expect(report.moves).toEqual([
      { from: 'Home/Chat Uploads/Bild.png', to: 'Home/Files/Chat/Bild.png' },
      { from: 'Projects/MKT/Chat Uploads/Plan.pdf', to: 'Projects/MKT/Files/Chat/Plan (2).pdf' },
      {
        from: 'Projects/MKT/Chat Uploads/Tiefer/Notiz.md',
        to: 'Projects/MKT/Files/Chat/Tiefer/Notiz.md',
      },
      {
        from: 'Projects/MKT/Files/Chat Attachments/Plan.pdf',
        to: 'Projects/MKT/Files/Chat/Plan (3).pdf',
      },
    ]);
    expect(existsSync(path.join(vault, 'Projects/MKT/Chat Uploads/Plan.pdf'))).toBe(true);
    expect(existsSync(path.join(vault, 'Home/Files/Chat'))).toBe(false);
    const [attachment] = await db
      .select({ vaultPath: chatAttachment.vaultPath })
      .from(chatAttachment)
      .where(eq(chatAttachment.id, attachmentId));
    expect(attachment!.vaultPath).toBe('Projects/MKT/Files/Chat Attachments/Plan.pdf');
  });

  it('moves the files with their references, removes the old folders and is idempotent', async () => {
    const report = await moveChatFilesToFolder({ apply: true });
    expect(report.failed).toEqual([]);
    expect(report.moves).toHaveLength(4);
    expect(report.removedFolders.sort()).toEqual(
      [
        'Home/Chat Uploads',
        'Projects/MKT/Chat Uploads',
        'Projects/MKT/Chat Uploads/Tiefer',
        'Projects/MKT/Files/Chat Attachments',
      ].sort(),
    );

    const read = (relative: string) => readFile(path.join(vault, relative), 'utf8');
    expect(await read('Projects/MKT/Files/Chat/Plan.pdf')).toBe('already there');
    expect(await read('Projects/MKT/Files/Chat/Plan (2).pdf')).toBe('upload');
    expect(await read('Projects/MKT/Files/Chat/Plan (3).pdf')).toBe('attachment');
    expect(await read('Projects/MKT/Files/Chat/Tiefer/Notiz.md')).toBe('# Notiz');
    expect(await read('Home/Files/Chat/Bild.png')).toBe('home');
    for (const gone of ['Projects/MKT/Chat Uploads', 'Projects/MKT/Files/Chat Attachments'])
      expect(existsSync(path.join(vault, gone))).toBe(false);
    expect(existsSync(path.join(vault, 'Home/Chat Uploads'))).toBe(false);

    const [attachment] = await db
      .select({ vaultPath: chatAttachment.vaultPath })
      .from(chatAttachment)
      .where(eq(chatAttachment.id, attachmentId));
    expect(attachment!.vaultPath).toBe(`Projects/MKT/${CHAT_FILES_FOLDER}/Plan (3).pdf`);
    const [message] = await db
      .select({ attachments: agentChatMessage.attachments })
      .from(agentChatMessage)
      .where(eq(agentChatMessage.id, messageId));
    expect(message!.attachments).toEqual([
      { kind: 'file', path: 'Projects/MKT/Files/Chat/Plan (2).pdf', name: 'Plan.pdf' },
      { kind: 'issue', key: 'MKT-1' },
    ]);
    const [homeMessage] = await db
      .select({ attachments: agentChatMessage.attachments })
      .from(agentChatMessage)
      .where(eq(agentChatMessage.id, homeMessageId));
    expect(homeMessage!.attachments).toEqual([
      { kind: 'file', path: 'Home/Files/Chat/Bild.png', name: 'Bild.png' },
    ]);

    // Old links find the files where they are now; the index knows the new paths only.
    expect(await resolveVaultPath('Projects/MKT/Chat Uploads/Plan.pdf')).toBe(
      'Projects/MKT/Files/Chat/Plan (2).pdf',
    );
    expect(await resolveVaultPath('Home/Chat Uploads/Bild.png')).toBe('Home/Files/Chat/Bild.png');
    const paths = (await db.select({ path: vaultEntry.path }).from(vaultEntry)).map(
      (row) => row.path,
    );
    expect(paths.some((entry) => entry.includes('Chat Uploads'))).toBe(false);
    expect(paths.some((entry) => entry.includes('Chat Attachments'))).toBe(false);
    expect(paths).toContain('Projects/MKT/Files/Chat/Tiefer/Notiz.md');

    const again = await moveChatFilesToFolder({ apply: true });
    expect(again.moves).toEqual([]);
    expect(again.removedFolders).toEqual([]);
    expect(again.failed).toEqual([]);
  });
});
