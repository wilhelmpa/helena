import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { indexVaultPaths } from '@repo/vault';
import { knowledgeSources, runSources } from '@helena/knowledge';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// Public boards are JSON Canvas files in the project's knowledge: Obsidian opens them,
// agents read them, the search finds their cards, and edits from either side survive.

type Client = ReturnType<typeof authedApi>;

const root = () => process.env.PROJECT_VAULT_ROOT!;

function boards(api: Client) {
  return api.projects({ projectKey: 'MKT' })['note-boards'];
}

async function readCanvas(relative: string) {
  return JSON.parse(await readFile(path.join(root(), relative), 'utf8')) as {
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  };
}

const sticker = (id: string, title: string, body: string, x = 0) => ({
  id,
  type: 'sticker' as const,
  position: { x, y: 10 },
  width: 260,
  height: 220,
  data: { title, body, color: '#D5F692' },
});

describe('note boards as JSON Canvas', () => {
  let api: Client;

  beforeEach(async () => {
    await resetDb();
    await rm(root(), { recursive: true, force: true });
    await mkdir(root(), { recursive: true });
    const owner = await signUpTestUser();
    api = authedApi(owner.cookie);
    await api.projects.post({ key: 'MKT', name: 'Marketing' });
  });

  it('keeps a public board as a canvas file that other apps can change', async () => {
    const created = await boards(api).post({
      name: 'Sprint: Ideen',
      canvas: { nodes: [sticker('a', 'Kühlregale', 'Drei **Angebote** holen')], edges: [] },
    });
    expect(created.status).toBe(201);
    const file = created.data!.vaultPath!;
    expect(file).toBe('Projects/MKT/Boards/Sprint Ideen.canvas');
    const canvas = await readCanvas(file);
    expect(canvas.nodes[0]).toMatchObject({
      id: 'a',
      type: 'text',
      x: 0,
      y: 10,
      width: 260,
      height: 220,
      color: '#D5F692',
      text: '# Kühlregale\n\nDrei **Angebote** holen',
    });

    // Obsidian adds a card, a file card and a connection.
    canvas.nodes.push(
      {
        id: 'b',
        type: 'text',
        x: 300,
        y: 10,
        width: 200,
        height: 100,
        text: 'Aus Obsidian',
        color: '4',
      },
      {
        id: 'f',
        type: 'file',
        x: 0,
        y: 300,
        width: 400,
        height: 300,
        file: 'Projects/MKT/Docs/Plan.md',
      },
    );
    canvas.edges.push(
      { id: 'e1', fromNode: 'a', toNode: 'b' },
      { id: 'e2', fromNode: 'a', toNode: 'f' },
    );
    await writeFile(path.join(root(), file), JSON.stringify(canvas, null, '\t'));
    await indexVaultPaths([file]);

    const read = await boards(api)({ boardId: created.data!.id }).get();
    expect(read.data!.canvas.nodes.map((node: { id: string }) => node.id)).toEqual(['a', 'b']);
    expect(read.data!.canvas.nodes[1].data).toMatchObject({
      title: '',
      body: 'Aus Obsidian',
      color: '#D5F692',
    });
    expect(read.data!.canvas.edges).toEqual([{ id: 'e1', source: 'a', target: 'b' }]);

    // Helena saves the board: the file card and its connection stay.
    const saved = await boards(api)({ boardId: created.data!.id }).patch({
      canvas: { nodes: [sticker('a', 'Kühlregale', 'Zwei Angebote da')], edges: [] },
    });
    expect(saved.status).toBe(200);
    const after = await readCanvas(file);
    expect(after.nodes.map((node) => node.id)).toEqual(['f', 'a']);
    expect(after.edges).toEqual([{ id: 'e2', fromNode: 'a', toNode: 'f' }]);

    // Its words are found by the one search.
    await runSources(knowledgeSources());
    const found = await api.knowledge.find.get({ query: { q: 'Angebote' } });
    expect(found.data!.items.map((item) => item.ref)).toContain(`vault:${file}`);
  });

  it('renames and trashes the file with the board, and moves a private board out', async () => {
    const created = await boards(api).post({ name: 'Plan' });
    const id = created.data!.id;
    const renamed = await boards(api)({ boardId: id }).patch({ name: 'Roadmap' });
    expect(renamed.data!.vaultPath).toBe('Projects/MKT/Boards/Roadmap.canvas');

    const privateBoard = await boards(api)({ boardId: id }).patch({ visibility: 'private' });
    expect(privateBoard.data!.vaultPath).toBeNull();
    expect(await Bun.file(path.join(root(), 'Projects/MKT/Boards/Roadmap.canvas')).exists()).toBe(
      false,
    );
    const publicAgain = await boards(api)({ boardId: id }).patch({ visibility: 'public' });
    expect(publicAgain.data!.vaultPath).toBe('Projects/MKT/Boards/Roadmap.canvas');

    expect((await boards(api)({ boardId: id }).delete()).status).toBe(204);
    expect(await Bun.file(path.join(root(), 'Projects/MKT/Boards/Roadmap.canvas')).exists()).toBe(
      false,
    );
    expect(
      await Bun.file(path.join(root(), '.trash/Projects/MKT/Boards/Roadmap.canvas')).exists(),
    ).toBe(true);
  });

  it('updates a canvas file node and its board hash when a Vault note moves', async () => {
    const from = 'Projects/MKT/Docs/Old.md';
    const to = 'Projects/MKT/Docs/New.md';
    await api.knowledge.notes.put({ path: from, content: 'old' });
    const board = await boards(api).post({ name: 'Links' });
    const file = board.data!.vaultPath!;
    const canvas = await readCanvas(file);
    canvas.nodes.push({ id: 'f', type: 'file', x: 0, y: 0, width: 200, height: 100, file: from });
    await writeFile(path.join(root(), file), JSON.stringify(canvas));
    await indexVaultPaths([file]);

    expect((await api.knowledge.move.post({ from, to })).status).toBe(200);
    expect((await readCanvas(file)).nodes[0]?.file).toBe(to);
    expect(
      (
        await boards(api)({ boardId: board.data!.id }).patch({
          canvas: { nodes: [sticker('note', 'After move', 'content')], edges: [] },
        })
      ).status,
    ).toBe(200);
  });

  it('turns a canvas made elsewhere into a board and drops a board whose file is gone', async () => {
    const relative = 'Projects/MKT/Boards/Aus Obsidian.canvas';
    await mkdir(path.dirname(path.join(root(), relative)), { recursive: true });
    await writeFile(
      path.join(root(), relative),
      JSON.stringify({
        nodes: [{ id: 'x', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'Hallo' }],
        edges: [],
      }),
    );
    await indexVaultPaths([relative]);
    const listed = await boards(api).get({ query: {} });
    const adopted = listed.data!.find((board) => board.vaultPath === relative)!;
    expect(adopted).toMatchObject({ name: 'Aus Obsidian', visibility: 'public' });
    const read = await boards(api)({ boardId: adopted.id }).get();
    expect(read.data!.canvas.nodes[0].data.body).toBe('Hallo');

    await rm(path.join(root(), relative));
    await indexVaultPaths([relative]);
    const after = await boards(api).get({ query: {} });
    expect(after.data!.some((board) => board.id === adopted.id)).toBe(false);
  });
});
