import { beforeEach, describe, expect, it } from 'bun:test';
import { readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import {
  agentChatMessage,
  agentChatThread,
  chatAttachment,
  db,
  initiativeAttachment,
  vaultEntry,
} from '@repo/db';
import { indexVaultPaths } from '@repo/vault';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import { freshVault } from '#tests/helpers/vault';
import { moveAttachmentsToVault } from '#modules/attachments/vault-migration';
import { getObject, putObject } from '#shared/s3';

let vault: string;
beforeEach(async () => {
  await resetDb();
  vault = freshVault();
});

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  await api.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = (await api.projects({ projectKey: 'MKT' }).get()).data!;
  const issue = (
    await api
      .projects({ projectKey: 'MKT' })
      .issues.post({ title: 'Original file', columnId: view.columns[0].id })
  ).data!;
  return { owner, api, view, issue, files: api.projects({ projectKey: 'MKT' }).files };
}

async function tool(key: string, name: string, args: Record<string, unknown>) {
  const res = await app.handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
  );
  const text = await res.text();
  return JSON.parse(text.slice(text.indexOf('data: ') + 6)).result;
}

describe('one canonical project vault', () => {
  it('agent artifact → ticket → editor → moved file → agent search/read, with actor and ACL', async () => {
    const { owner, api, view, issue, files } = await setup();
    await api
      .teams({ teamId: view.project.teamId })
      .mcp.patch({ enabled: true, projects: [{ projectId: view.project.id, enabled: true }] });
    const agent = (
      await createAgent(api, 'MKT', { name: 'Archivist', username: 'archivist', kind: 'external' })
    ).data!;
    const uploaded = await tool(agent.apiKey!, 'upload_chat_attachment', {
      projectKey: 'MKT',
      filename: 'Report.md',
      contentBase64: Buffer.from('# Quarzbericht\n\nSource: [[MKT-1]]').toString('base64'),
    });
    expect(uploaded.isError).not.toBe(true);
    const file = uploaded.structuredContent.data as { id: string; vaultPath: string };
    expect(file.vaultPath).toBe('Projects/MKT/Files/Chat Attachments/Report.md');
    const [entry] = await db.select().from(vaultEntry).where(eq(vaultEntry.path, file.vaultPath));
    expect(entry.lastAuthor).toBe(`agent:${agent.agent.id}`);
    const relative = file.vaultPath.slice('Projects/MKT/'.length);
    const linked = await api
      .issues({ issueId: issue.id })
      .attachments.link.post({ path: relative });
    expect(linked.status).toBe(201);
    expect(linked.data!.vaultPath).toBe(file.vaultPath);
    await db.insert(agentChatThread).values({
      id: 'fixture-thread',
      agentId: agent.agent.id,
      userId: owner.userId,
      projectId: view.project.id,
      title: 'Private conversation title',
    });
    await db.insert(agentChatMessage).values({
      threadId: 'fixture-thread',
      agentId: agent.agent.id,
      role: 'user',
      attachments: [{ kind: 'file', path: file.vaultPath }],
    });
    const role = (
      await createRole(api, 'MKT', {
        name: 'File reader',
        permissions: { documents: { read: true } },
      })
    ).data!;
    const reader = await addProjectMember(api, 'MKT', role.id);
    const restricted = await reader
      .projects({ projectKey: 'MKT' })
      .files.references.get({ query: { path: relative } });
    expect(restricted.status).toBe(200);
    expect(restricted.data!.links).toEqual([]);
    const references = await files.references.get({ query: { path: relative } });
    expect(references.data!.author).toBe('Archivist');
    expect(references.data!.links.some((link) => link.kind === 'chat')).toBe(true);
    expect(
      references.data!.links.some(
        (link) => link.kind === 'ticket' && link.href === '/project/MKT/issue/1',
      ),
    ).toBe(true);
    const text = (await files.text.get({ query: { path: relative } })).data!;
    expect(
      (
        await files.text.put({
          path: relative,
          expectedEtag: text.etag,
          content: '# Quarzbericht\n\nReviewed [[MKT-1]]',
        })
      ).status,
    ).toBe(200);
    expect(
      (await files.text.put({ path: relative, expectedEtag: text.etag, content: 'stale' })).status,
    ).toBe(409);
    expect(await readFile(path.join(vault, file.vaultPath), 'utf8')).toContain('Reviewed');
    await files.folders.post({ path: 'Docs' });
    expect((await files.move.post({ from: relative, to: 'Docs/Report.md' })).status).toBe(200);
    const movedReferences = await files.references.get({ query: { path: 'Docs/Report.md' } });
    expect(movedReferences.data!.links.some((link) => link.kind === 'chat')).toBe(true);
    expect((await api.knowledge.resolve.get({ query: { path: file.vaultPath } })).data!.path).toBe(
      'Projects/MKT/Docs/Report.md',
    );
    const chat = await api['chat-attachments']({ publicId: file.id }).get();
    expect(chat.data!.vaultPath).toBe('Projects/MKT/Docs/Report.md');
    expect(chat.data!.text).toContain('Reviewed');
    expect((await api.issues({ issueId: issue.id }).attachments.get()).data![0].vaultPath).toBe(
      'Projects/MKT/Docs/Report.md',
    );
    const found = await tool(agent.apiKey!, 'search_knowledge', { q: 'Quarzbericht' });
    expect(
      found.structuredContent.data.items.some(
        (hit: { path: string }) => hit.path === 'Projects/MKT/Docs/Report.md',
      ),
    ).toBe(true);
    const read = await tool(agent.apiKey!, 'read_chat_attachment', { publicId: file.id });
    expect(read.structuredContent.data.text).toContain('Reviewed');
    const stranger = authedApi((await signUpTestUser()).cookie);
    expect((await stranger['chat-attachments']({ publicId: file.id }).raw.get()).status).toBe(403);
    expect((await stranger.attachments({ publicId: linked.data!.id }).raw.get()).status).toBe(403);
    expect(
      (
        await stranger.knowledge.search.get({
          query: { q: 'Quarzbericht', folder: 'Projects/MKT' },
        })
      ).status,
    ).toBe(403);
  });

  it('moves file metadata in project and Home chats, retaining unrelated paths and message text', async () => {
    const { api, owner, view, files } = await setup();
    await api.projects.post({ key: 'OPS', name: 'Operations' });
    const other = (await api.projects({ projectKey: 'OPS' }).get()).data!.project;
    const agent = (
      await createAgent(api, 'MKT', {
        name: 'Archivist',
        username: 'archivist',
        kind: 'external',
      })
    ).data!.agent;
    const original = 'Projects/MKT/Files/proof/Cycle.md';
    const moved = 'Projects/MKT/Docs/proof/Cycle.md';
    await files.text.post({ path: 'Files/proof/Cycle.md', content: '# Synthetic' });
    await files.folders.post({ path: 'Docs' });
    const attachments = [
      { kind: 'file', path: original, name: 'Cycle.md', sizeBytes: 11 },
      { kind: 'file', path: 'Projects/OPS/Files/proof/Cycle.md', name: 'Cycle.md' },
      { kind: 'file', path: 'Projects/MKT/Files/proof-other/Cycle.md', name: 'Cycle.md' },
      { kind: 'task', path: original, issueId: 123 },
    ];
    for (const [id, projectId] of [
      ['project', view.project.id],
      ['home', null],
      ['foreign', other.id],
    ] as const) {
      await db
        .insert(agentChatThread)
        .values({ id, projectId, userId: owner.userId, agentId: agent.id });
      await db.insert(agentChatMessage).values({
        threadId: id,
        agentId: agent.id,
        role: 'user',
        attachments,
        content: `Historical path ${original}`,
      });
    }
    const [legacy] = await db
      .insert(agentChatMessage)
      .values({
        threadId: 'project',
        agentId: agent.id,
        role: 'user',
        attachments: {},
      })
      .returning();
    expect((await files.move.post({ from: 'Files/proof', to: 'Docs/proof' })).status).toBe(200);
    for (const id of ['project', 'home', 'foreign']) {
      const [message] = await db
        .select()
        .from(agentChatMessage)
        .where(eq(agentChatMessage.threadId, id))
        .orderBy(agentChatMessage.id);
      expect(message.content).toBe(`Historical path ${original}`);
      expect(message.attachments).toEqual([
        { ...attachments[0], path: id === 'foreign' ? original : moved },
        ...attachments.slice(1),
      ]);
    }
    expect(
      (await db.select().from(agentChatMessage).where(eq(agentChatMessage.id, legacy.id)))[0]
        .attachments,
    ).toEqual({});
    expect((await api.knowledge.resolve.get({ query: { path: original } })).data!.path).toBe(moved);
    const refs = (await files.references.get({ query: { path: 'Docs/proof/Cycle.md' } })).data!;
    expect(
      refs.links
        .filter((link) => link.kind === 'chat')
        .map((link) => link.href)
        .sort(),
    ).toEqual([`/chat?agent=${agent.id}&thread=home`, `/chat?agent=${agent.id}&thread=project`]);
  });

  it('rejects a racing second edit instead of silently losing one draft', async () => {
    const { files } = await setup();
    await files.text.post({ path: 'shared.txt', content: 'base' });
    const read = (await files.text.get({ query: { path: 'shared.txt' } })).data!;
    const writes = await Promise.all(
      ['first', 'second'].map((content) =>
        files.text.put({ path: 'shared.txt', content, expectedEtag: read.etag }),
      ),
    );
    expect(writes.map((result) => result.status).sort()).toEqual([200, 409]);
  });

  it('retains shared template and owner Home file references inside project chats', async () => {
    const { api, owner, view } = await setup();
    const agent = (
      await createAgent(api, 'MKT', {
        name: 'Archivist',
        username: 'archivist',
        kind: 'external',
      })
    ).data!.agent;
    await db.insert(agentChatThread).values({
      id: 'project-shared',
      projectId: view.project.id,
      userId: owner.userId,
      agentId: agent.id,
    });
    await db.insert(agentChatMessage).values({
      threadId: 'project-shared',
      agentId: agent.id,
      role: 'user',
      attachments: [
        { kind: 'file', path: 'Templates/shared.md' },
        { kind: 'file', path: 'Home/shared.md' },
      ],
    });
    for (const root of ['templates', 'home'] as const) {
      expect(
        (
          await api.files.text.post(
            { path: 'shared.md', content: '# Synthetic' },
            { query: { root } },
          )
        ).status,
      ).toBe(201);
      expect(
        (await api.files.move.post({ from: 'shared.md', to: 'renamed.md' }, { query: { root } }))
          .status,
      ).toBe(200);
    }
    const [message] = await db
      .select()
      .from(agentChatMessage)
      .where(eq(agentChatMessage.threadId, 'project-shared'));
    expect(message.attachments).toEqual([
      { kind: 'file', path: 'Templates/renamed.md' },
      { kind: 'file', path: 'Home/renamed.md' },
    ]);
  });

  it('outside-editor move followed by edit retains historical attachment paths', async () => {
    const { api, files } = await setup();
    const up = (
      await api.projects({ projectKey: 'MKT' })['chat-attachments'].post({
        filename: 'Original.md',
        contentBase64: Buffer.from('# First').toString('base64'),
      })
    ).data!;
    const before = up.vaultPath!;
    const after = 'Projects/MKT/Docs/Renamed.md';
    await mkdir(path.dirname(path.join(vault, after)), { recursive: true });
    const { rename } = await import('node:fs/promises');
    await rename(path.join(vault, before), path.join(vault, after));
    await indexVaultPaths([before, after], { author: 'notes' });
    await writeFile(path.join(vault, after), '# Changed in SilverBullet');
    await indexVaultPaths([after], { author: 'notes' });
    expect((await api['chat-attachments']({ publicId: up.id }).get()).data!.text).toBe(
      '# Changed in SilverBullet',
    );
    expect((await files.text.get({ query: { path: 'Docs/Renamed.md' } })).data!.content).toBe(
      '# Changed in SilverBullet',
    );
  });

  it('migrates chat and initiative originals reversibly and handles filename conflicts', async () => {
    const { api, view } = await setup();
    const initiative = (
      await api.projects({ projectKey: 'MKT' }).initiatives.post({ title: 'Project' })
    ).data!;
    const common = { filename: 'legacy.txt', contentType: 'text/plain', sizeBytes: 6 };
    await putObject('migration/chat.txt', Buffer.from('legacy'), 'text/plain');
    await putObject('migration/initiative.txt', Buffer.from('legacy'), 'text/plain');
    await db
      .insert(chatAttachment)
      .values({ ...common, projectId: view.project.id, s3Key: 'migration/chat.txt' });
    await db
      .insert(initiativeAttachment)
      .values({ ...common, initiativeId: initiative.id, s3Key: 'migration/initiative.txt' });
    const folder = path.join(vault, 'Projects/MKT/Files/Chat Attachments');
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'legacy.txt'), 'different');
    expect((await moveAttachmentsToVault({ dryRun: true })).pending).toBe(2);
    const receipt = await moveAttachmentsToVault();
    expect(receipt.failed).toEqual([]);
    expect(receipt.moved).toHaveLength(2);
    expect(await readFile(path.join(folder, 'legacy.txt'), 'utf8')).toBe('different');
    expect(await readFile(path.join(folder, 'legacy (2).txt'), 'utf8')).toBe('legacy');
    expect(await new Response((await getObject('migration/chat.txt')).body).text()).toBe('legacy');
    expect((await moveAttachmentsToVault()).pending).toBe(0);
  });

  it('indexes binary uploads with text filenames without serializing their bytes as text', async () => {
    const { files } = await setup();
    expect(
      (await files.upload.post({ files: [new File([new Uint8Array([1, 0, 2, 3])], 'binary.txt')] }))
        .status,
    ).toBe(201);
    const [entry] = await db
      .select()
      .from(vaultEntry)
      .where(eq(vaultEntry.path, 'Projects/MKT/binary.txt'));
    expect(entry.text).toBeNull();
    expect(entry.extractionError).toBe('binary_content');
  });

  it('denies symbolic project roots and keeps Home text revisions private', async () => {
    const { api, files } = await setup();
    await mkdir(path.join(vault, 'Private'), { recursive: true });
    await writeFile(path.join(vault, 'Private/secret.txt'), 'private fixture');
    await mkdir(path.join(vault, 'Projects'), { recursive: true });
    await symlink(path.join(vault, 'Private'), path.join(vault, 'Projects/MKT'));
    expect((await files.text.get({ query: { path: 'secret.txt' } })).status).toBe(400);
    const home = await api.files.text.post(
      { path: 'hello.txt', content: 'one' },
      { query: { root: 'home' } },
    );
    expect(home.status).toBe(201);
    const read = (await api.files.text.get({ query: { root: 'home', path: 'hello.txt' } })).data!;
    expect(
      (
        await api.files.text.put(
          { path: 'hello.txt', content: 'two', expectedEtag: read.etag },
          { query: { root: 'home' } },
        )
      ).status,
    ).toBe(200);
    expect(await readFile(path.join(vault, '.trash/Home/hello.txt'), 'utf8')).toBe('one');
  });
});
