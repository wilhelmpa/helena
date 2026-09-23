import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { apiKeyApi, app, authedApi, type Api } from '#tests/helpers/app';
import { createAgent } from '#tests/helpers/agents';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';
import { bootstrapHomeAgent } from '../../../../scripts/bootstrap-home-agent';

const root = () => process.env.PROJECT_VAULT_ROOT!;
const hasGit = Bun.which('git') !== null;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  return { asOwner, owner };
}

async function write(api: Api, notePath: string, content: string, expectedSha?: string) {
  return api.knowledge.notes.put({ path: notePath, content, expectedSha });
}

async function read(api: Api, notePath: string) {
  return api.knowledge.documents.get({ query: { path: notePath } });
}

async function git(...args: string[]) {
  const child = Bun.spawn(['git', '-C', root(), ...args], { stdout: 'pipe', stderr: 'pipe' });
  await child.exited;
  return new Response(child.stdout).text();
}

describe('knowledge', () => {
  beforeEach(async () => {
    await resetDb();
    await rm(root(), { recursive: true, force: true });
    await mkdir(root(), { recursive: true });
  });

  describe('notes', () => {
    it('creates, reads and updates a note with its sha, and refuses a stale one', async () => {
      const { asOwner } = await setup();
      const notePath = 'Projects/MKT/Docs/Guides/Release.md';

      const created = await write(asOwner, notePath, '# Release\n\nRun the workflow.\n');
      expect(created.status).toBe(200);
      expect(created.data).toMatchObject({ path: notePath, created: true, title: 'Release' });
      expect(await readFile(path.join(root(), notePath), 'utf8')).toBe(
        '# Release\n\nRun the workflow.\n',
      );

      const note = await read(asOwner, notePath);
      expect(note.data).toMatchObject({
        kind: 'note',
        sha256: created.data!.sha256,
        projectKey: 'MKT',
        body: '# Release\n\nRun the workflow.\n',
        obsidianUrl: `obsidian://open?vault=Volition&file=${encodeURIComponent(notePath)}`,
      });
      expect(note.data!.absolutePath).toBe(path.join(root(), notePath));

      const again = await write(asOwner, notePath, 'Other');
      expect(again.status).toBe(409);
      expect(again.error?.value).toMatchObject({ code: 'exists' });

      const updated = await write(asOwner, notePath, 'Second', created.data!.sha256);
      expect(updated.data).toMatchObject({ created: false });

      const stale = await write(asOwner, notePath, 'Third', created.data!.sha256);
      expect(stale.status).toBe(409);
      expect(stale.error?.value).toMatchObject({ code: 'conflict' });
      expect((await read(asOwner, notePath)).data?.content).toBe('Second');
    });

    it('sees a change made outside Plan as a conflict', async () => {
      const { asOwner } = await setup();
      const notePath = 'Projects/MKT/Docs/Plan.md';
      const created = await write(asOwner, notePath, 'Plan');
      await writeFile(path.join(root(), notePath), 'Edited in Obsidian');

      const save = await write(asOwner, notePath, 'Plan, edited', created.data!.sha256);
      expect(save.status).toBe(409);
      expect((await read(asOwner, notePath)).data?.content).toBe('Edited in Obsidian');
    });

    it('keeps the frontmatter formatting when only the body or one property changes', async () => {
      const { asOwner } = await setup();
      const notePath = 'Projects/MKT/Docs/Spec.md';
      const original = '---\n# owner note\ntype: spec\ntags: [api, v2]\n---\nBody\n';
      const created = await write(asOwner, notePath, original);
      const note = await read(asOwner, notePath);
      expect(note.data).toMatchObject({
        frontmatter: { type: 'spec', tags: ['api', 'v2'] },
        body: 'Body\n',
      });

      const bodyOnly = await asOwner.knowledge.notes.put({
        path: notePath,
        body: 'New body\n',
        frontmatter: { type: 'spec', tags: ['api', 'v2'] },
        expectedSha: created.data!.sha256,
      });
      expect(await readFile(path.join(root(), notePath), 'utf8')).toBe(
        '---\n# owner note\ntype: spec\ntags: [api, v2]\n---\nNew body\n',
      );

      await asOwner.knowledge.notes.put({
        path: notePath,
        body: 'New body\n',
        frontmatter: { type: 'decision', tags: ['api', 'v2'] },
        expectedSha: bodyOnly.data!.sha256,
      });
      const text = await readFile(path.join(root(), notePath), 'utf8');
      expect(text).toContain('# owner note');
      expect(text).toContain('type: decision');
      expect(text).toContain('tags: [api, v2]');
    });

    it('refuses paths outside the rules', async () => {
      const { asOwner } = await setup();
      expect((await write(asOwner, 'Projects/MKT/Docs/../../../etc/passwd', 'x')).status).toBe(400);
      expect((await write(asOwner, 'Projects/MKT/Docs/notes.txt', 'x')).status).toBe(400);
      expect((await write(asOwner, 'Projects/MKT/.obsidian/app.md', 'x')).status).toBe(403);
      expect((await read(asOwner, 'Projects/MKT/Docs/missing.md')).status).toBe(404);
    });

    it('lists the Docs tree and a folder', async () => {
      const { asOwner } = await setup();
      await write(asOwner, 'Projects/MKT/Docs/A.md', 'a');
      await write(asOwner, 'Projects/MKT/Docs/Sub/B.md', '---\ntitle: Bee\n---\nb');
      await mkdir(path.join(root(), 'Projects/MKT/Docs/Empty'), { recursive: true });
      await writeFile(path.join(root(), 'Projects/MKT/Docs/image.png'), 'png');

      const tree = await asOwner.knowledge.tree.get({ query: { root: 'Projects/MKT/Docs' } });
      expect(tree.data?.items.map((item) => [item.path, item.kind, item.title])).toEqual([
        ['Projects/MKT/Docs/A.md', 'note', 'A'],
        ['Projects/MKT/Docs/Empty', 'folder', 'Empty'],
        ['Projects/MKT/Docs/Sub', 'folder', 'Sub'],
        ['Projects/MKT/Docs/Sub/B.md', 'note', 'Bee'],
      ]);

      const folder = await asOwner.knowledge.folders.get({ query: { path: 'Projects/MKT/Docs' } });
      expect(folder.data?.items.map((item) => [item.name, item.kind])).toEqual([
        ['Empty', 'folder'],
        ['Sub', 'folder'],
        ['A.md', 'note'],
        ['image.png', 'file'],
      ]);
    });

    it('moves, trashes and restores a note, and resolves its old path', async () => {
      const { asOwner } = await setup();
      const from = 'Projects/MKT/Docs/Handbook.md';
      const to = 'Projects/MKT/Docs/Guides/Handbook.md';
      const created = await write(asOwner, from, 'Handbook');

      expect((await asOwner.knowledge.move.post({ from, to })).data).toEqual({ path: to });
      expect((await read(asOwner, from)).status).toBe(404);
      expect((await read(asOwner, to)).data?.content).toBe('Handbook');
      const resolved = await asOwner.knowledge.resolve.get({ query: { path: from } });
      expect(resolved.data).toEqual({ path: to });
      const bySha = await asOwner.knowledge.resolve.get({
        query: { path: 'Projects/MKT/Docs/Gone.md', sha256: created.data!.sha256 },
      });
      expect(bySha.data).toEqual({ path: to });

      expect(
        (await asOwner.knowledge.move.post({ from: to, to: 'Projects/MKT/Docs/x.txt' })).status,
      ).toBe(400);
      expect((await asOwner.knowledge.trash.post({ path: to })).status).toBe(200);
      expect((await read(asOwner, to)).status).toBe(404);
      expect(await readFile(path.join(root(), '.trash', to), 'utf8')).toBe('Handbook');
      const trashed = await asOwner.knowledge.trash.get({ query: { path: 'Projects/MKT/Docs' } });
      expect(trashed.data?.map((item) => item.path)).toEqual([to]);

      expect((await asOwner.knowledge.restore.post({ path: to })).status).toBe(200);
      expect((await read(asOwner, to)).data?.content).toBe('Handbook');
    });

    it('stores a pasted image in the Assets folder beside the note and serves it', async () => {
      const { asOwner } = await setup();
      const notePath = 'Projects/MKT/Docs/Note.md';
      await write(asOwner, notePath, 'Note');
      const file = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
      const first = await asOwner.knowledge.assets.post({ file }, { query: { path: notePath } });
      const second = await asOwner.knowledge.assets.post({ file }, { query: { path: notePath } });
      expect(first.data).toEqual({ path: 'Projects/MKT/Docs/Assets/shot.png' });
      expect(second.data).toEqual({ path: 'Projects/MKT/Docs/Assets/shot 2.png' });

      const raw = await asOwner.knowledge.raw.get({
        query: { path: 'Projects/MKT/Docs/Assets/shot.png' },
      });
      expect(raw.status).toBe(200);
      expect(raw.response.headers.get('content-type')).toBe('image/png');
      expect(raw.response.headers.get('x-content-type-options')).toBe('nosniff');
    });
  });

  it('lists Syncthing conflict copies apart from the notes', async () => {
    const { asOwner } = await setup();
    await write(asOwner, 'Projects/MKT/Docs/Plan.md', 'Mine');
    const copy = 'Projects/MKT/Docs/Plan.sync-conflict-20260923-101500-ABCDEF7.md';
    await writeFile(path.join(root(), copy), 'Theirs');

    const conflicts = await asOwner.knowledge.conflicts.get({
      query: { root: 'Projects/MKT/Docs' },
    });
    expect(conflicts.data).toEqual([
      expect.objectContaining({ path: copy, original: 'Projects/MKT/Docs/Plan.md' }),
    ]);
    const tree = await asOwner.knowledge.tree.get({ query: { root: 'Projects/MKT/Docs' } });
    expect(tree.data?.items.map((item) => item.path)).toEqual(['Projects/MKT/Docs/Plan.md']);
    expect((await asOwner.knowledge.trash.post({ path: copy })).status).toBe(200);
    const after = await asOwner.knowledge.conflicts.get({ query: { root: 'Projects/MKT/Docs' } });
    expect(after.data).toEqual([]);
  });

  describe('links', () => {
    it('lists the notes linking to a note and to a task, and resolves wikilinks', async () => {
      const { asOwner } = await setup();
      const board = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
      const column = board.columns[0];
      const issue = (
        await asOwner.projects({ projectKey: 'MKT' }).issues.post({
          title: 'Ship it',
          columnId: column.id,
        })
      ).data!;
      await write(asOwner, 'Projects/MKT/Docs/Specs/API.md', '# API');
      await write(
        asOwner,
        'Projects/MKT/Docs/Decision.md',
        `See [[API]] and [[${issue.identifier}]].\n\n\`[[Ignored]]\`\n`,
      );
      await write(asOwner, 'Projects/MKT/Docs/Other.md', 'Relative [link](Specs/API.md)');

      const toNote = await asOwner.knowledge.backlinks.get({
        query: { path: 'Projects/MKT/Docs/Specs/API.md' },
      });
      expect(toNote.data?.map((note) => note.path)).toEqual([
        'Projects/MKT/Docs/Decision.md',
        'Projects/MKT/Docs/Other.md',
      ]);

      const toTask = await asOwner.knowledge.backlinks.get({
        query: { task: issue.identifier.toLowerCase() },
      });
      expect(toTask.data).toEqual([
        expect.objectContaining({ path: 'Projects/MKT/Docs/Decision.md', title: 'Decision' }),
      ]);

      const link = await asOwner.knowledge.wikilink.get({
        query: { from: 'Projects/MKT/Docs/Decision.md', target: 'api' },
      });
      expect(link.data).toEqual({ path: 'Projects/MKT/Docs/Specs/API.md' });
      const missing = await asOwner.knowledge.wikilink.get({
        query: { from: 'Projects/MKT/Docs/Decision.md', target: 'Ignored' },
      });
      expect(missing.data).toEqual({ path: null });
      expect((await asOwner.knowledge.backlinks.get({ query: {} })).status).toBe(400);
    });
  });

  describe('search', () => {
    it('ranks notes by German words and word beginnings, with an excerpt', async () => {
      const { asOwner } = await setup();
      await write(
        asOwner,
        'Projects/MKT/Docs/Finanzen.md',
        'Die Rechnungen wurden im Mai bezahlt.',
      );
      await write(asOwner, 'Projects/MKT/Docs/Rechnung.md', 'Eine Rechnung.');
      await write(asOwner, 'Projects/MKT/Docs/Anderes.md', 'Nichts davon.');

      const stemmed = await asOwner.knowledge.search.get({ query: { q: 'Rechnung' } });
      expect(stemmed.data?.items.map((item) => item.path)).toEqual([
        'Projects/MKT/Docs/Rechnung.md',
        'Projects/MKT/Docs/Finanzen.md',
      ]);
      expect(stemmed.data?.items[1].snippet).toContain('**Rechnungen**');

      const prefix = await asOwner.knowledge.search.get({ query: { q: 'bezah' } });
      expect(prefix.data?.items.map((item) => item.path)).toEqual([
        'Projects/MKT/Docs/Finanzen.md',
      ]);

      const folder = await asOwner.knowledge.search.get({
        query: { q: 'Rechnung', folder: 'Projects/MKT/Docs/Sub' },
      });
      expect(folder.data?.items).toEqual([]);
    });

    it('finds only what the caller may read', async () => {
      const { asOwner } = await setup();
      await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
      await write(asOwner, 'Projects/MKT/Docs/Plan.md', 'Kampagne');
      await write(asOwner, 'Projects/OPS/Docs/Plan.md', 'Kampagne');
      await write(asOwner, 'Private/Diary.md', 'Kampagne');
      const member = await addProjectMember(asOwner, 'MKT');

      const found = await member.knowledge.search.get({ query: { q: 'Kampagne' } });
      expect(found.data?.items.map((item) => item.path)).toEqual(['Projects/MKT/Docs/Plan.md']);
      const all = await asOwner.knowledge.search.get({ query: { q: 'Kampagne' } });
      expect(all.data?.items.map((item) => item.path).sort()).toEqual([
        'Private/Diary.md',
        'Projects/MKT/Docs/Plan.md',
        'Projects/OPS/Docs/Plan.md',
      ]);
    });
  });

  describe('access', () => {
    it('follows the project role for people and keeps Home and Private to the owner', async () => {
      const { asOwner } = await setup();
      await write(asOwner, 'Projects/MKT/Docs/Plan.md', 'Plan');
      const readOnly = (
        await createRole(asOwner, 'MKT', {
          name: 'Reader',
          permissions: { documents: { read: true } },
        })
      ).data!;
      const noDocs = (
        await createRole(asOwner, 'MKT', {
          name: 'Work items',
          permissions: { work_items: { read: true } },
        })
      ).data!;
      const reader = await addProjectMember(asOwner, 'MKT', readOnly.id);
      const outsider = await addProjectMember(asOwner, 'MKT', noDocs.id);
      const stranger = authedApi((await signUpTestUser()).cookie);

      expect((await read(reader, 'Projects/MKT/Docs/Plan.md')).status).toBe(200);
      expect((await write(reader, 'Projects/MKT/Docs/New.md', 'x')).status).toBe(403);
      expect((await read(outsider, 'Projects/MKT/Docs/Plan.md')).status).toBe(403);
      expect((await read(stranger, 'Projects/MKT/Docs/Plan.md')).status).toBe(403);

      expect((await write(asOwner, 'Home/Docs/Ideas.md', 'Ideas')).status).toBe(200);
      expect((await write(asOwner, 'Private/Diary.md', 'Diary')).status).toBe(200);
      expect((await read(reader, 'Home/Docs/Ideas.md')).status).toBe(403);
      expect((await read(reader, 'Private/Diary.md')).status).toBe(403);
      expect((await read(reader, 'Templates/Meeting.md')).status).toBe(404);
    });

    it('limits a project agent to its project and Templates, and never Private', async () => {
      const { asOwner } = await setup();
      await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
      await write(asOwner, 'Projects/OPS/Docs/Secret.md', 'x');
      await write(asOwner, 'Templates/Meeting.md', '# Meeting');
      await write(asOwner, 'Private/Diary.md', 'Diary');
      const agent = await createAgent(asOwner, 'MKT', {
        name: 'Writer',
        username: 'writer',
        kind: 'external',
      });
      const asAgent = apiKeyApi(agent.data!.apiKey!);

      const note = await write(asAgent, 'Projects/MKT/Docs/Findings.md', 'Found it');
      expect(note.data?.created).toBe(true);
      expect((await read(asAgent, 'Templates/Meeting.md')).status).toBe(200);
      expect((await write(asAgent, 'Templates/Meeting.md', 'x')).status).toBe(403);
      expect((await read(asAgent, 'Projects/OPS/Docs/Secret.md')).status).toBe(403);
      expect((await read(asAgent, 'Private/Diary.md')).status).toBe(403);
      expect((await write(asAgent, 'Home/Docs/Agent.md', 'x')).status).toBe(403);
      const found = await asAgent.knowledge.search.get({ query: { q: 'Diary' } });
      expect(found.data?.items).toEqual([]);
    });

    it('lets the Home agent read every project and write only Home', async () => {
      const { asOwner } = await setup();
      const home = await bootstrapHomeAgent();
      if (home.status !== 'ready') throw new Error('Home agent was not provisioned');
      const asHome = apiKeyApi(home.apiKey);
      await write(asOwner, 'Projects/MKT/Docs/Plan.md', 'Plan');
      await write(asOwner, 'Private/Diary.md', 'Diary');

      expect((await read(asHome, 'Projects/MKT/Docs/Plan.md')).status).toBe(200);
      expect((await write(asHome, 'Projects/MKT/Docs/Home.md', 'x')).status).toBe(403);
      expect((await write(asHome, 'Home/Docs/Overview.md', 'Overview')).status).toBe(200);
      expect((await read(asHome, 'Private/Diary.md')).status).toBe(403);
      const root = await asHome.knowledge.folders.get({ query: {} });
      expect(root.data?.items.map((item) => item.name)).not.toContain('Private');
    });
  });

  describe('history', () => {
    it.skipIf(!hasGit)('commits each save as its author and returns old versions', async () => {
      const { asOwner } = await setup();
      await git('init', '--quiet');
      const notePath = 'Projects/MKT/Docs/History.md';
      const first = await write(asOwner, notePath, 'One');
      await write(asOwner, notePath, 'Two', first.data!.sha256);
      await writeFile(path.join(root(), 'Projects/MKT/Docs/picture.png'), 'binary');

      const history = await asOwner.knowledge.history.get({ query: { path: notePath } });
      expect(history.data?.map((entry) => [entry.authorName, entry.message])).toEqual([
        ['Owner', `Update ${notePath}`],
        ['Owner', `Create ${notePath}`],
      ]);
      const version = await asOwner.knowledge.history.version.get({
        query: { path: notePath, commit: history.data![1].commit },
      });
      expect(version.data?.content).toBe('One');
      expect(await git('ls-files')).not.toContain('picture.png');
    });
  });

  describe('MCP', () => {
    async function rpc(apiKey: string, method: string, params: Record<string, unknown> = {}) {
      const res = await app.handle(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }),
      );
      const text = await res.text();
      return JSON.parse(text.slice(text.indexOf('data: ') + 6)).result;
    }

    it('offers the knowledge tools and keeps an agent to its reach', async () => {
      const { asOwner } = await setup();
      const project = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!.project;
      await asOwner.teams({ teamId: project.teamId }).mcp.patch({
        enabled: true,
        projects: [{ projectId: project.id, enabled: true }],
      });
      await write(asOwner, 'Private/Diary.md', 'Diary');
      const agent = await createAgent(asOwner, 'MKT', {
        name: 'Writer',
        username: 'writer',
        kind: 'external',
      });
      const apiKey = agent.data!.apiKey!;

      const { tools } = await rpc(apiKey, 'tools/list');
      const names = (tools as { name: string }[]).map((tool) => tool.name);
      for (const name of [
        'search_knowledge',
        'read_document',
        'write_note',
        'list_folder',
        'backlinks',
      ]) {
        expect(names).toContain(name);
      }

      const written = await rpc(apiKey, 'tools/call', {
        name: 'write_note',
        arguments: { path: 'Projects/MKT/Docs/Handover.md', content: 'Handover for [[MKT-1]]' },
      });
      expect(written.isError).not.toBe(true);
      const found = await rpc(apiKey, 'tools/call', {
        name: 'search_knowledge',
        arguments: { q: 'Handover' },
      });
      expect(found.content[0].text).toContain('Projects/MKT/Docs/Handover.md');
      const secret = await rpc(apiKey, 'tools/call', {
        name: 'read_document',
        arguments: { path: 'Private/Diary.md' },
      });
      expect(secret.isError).toBe(true);
    });
  });

  it('copies the Docs folder with a project', async () => {
    const { asOwner } = await setup();
    await write(asOwner, 'Projects/MKT/Docs/Sub/Guide.md', 'Guide');
    const source = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
    const copy = await asOwner.projects({ projectKey: 'MKT' }).copy.post({
      key: 'CPY',
      name: 'Copy',
      include: { documents: true },
    });
    expect(copy.status).toBe(201);
    expect(source.project.key).toBe('MKT');
    expect((await read(asOwner, 'Projects/CPY/Docs/Sub/Guide.md')).data?.content).toBe('Guide');
  });
});
