import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { provisionBoards } from '../boards.mjs';
import { validateEnvelope } from '../validation.mjs';

const id = '123e4567-e89b-42d3-a456-426614174000';
function envelope() {
  return { eventId: id, eventType: 'project.provision', project: { id: 7, key: 'DEMO', name: 'Demo', teamId: 3 }, createdAt: '2026-09-21T00:00:00.000Z', requestedResources: ['workspace', 'board:12'], boards: [{ resource: 'board:12', id: 12, name: 'First board', slug: 'first-board', folder: null }] };
}
const headers = { idempotencyKey: id, eventType: 'project.provision' };

test('board envelope rejects mismatched ids, unsafe slugs and absent metadata', () => {
  assert.equal(validateEnvelope(envelope(), headers).boards[0].id, 12);
  for (const edit of [(v) => v.boards[0].id = 13, (v) => v.boards[0].slug = '../../escape', (v) => v.boards = []]) {
    const value = envelope(); edit(value);
    assert.throws(() => validateEnvelope(value, headers));
  }
});

test('board retries and rename preserve paths and existing content; symlinks are refused', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'volition-boards-'));
  try {
    const workspace = { slug: 'demo', hostPath: root, containerPath: '/projects/demo' };
    const config = { planUrl: 'https://plan.test', codeUrl: 'https://code.test' };
    const value = envelope();
    const first = await provisionBoards(config, value, workspace);
    await fs.writeFile(path.join(root, 'boards/board-12/user-document.txt'), 'keep');
    value.boards[0].name = 'Renamed board'; value.boards[0].slug = 'renamed-board';
    const second = await provisionBoards(config, value, workspace);
    assert.deepEqual(second, first);
    assert.deepEqual(first.map((resource) => resource.kind), ['board:12']);
    assert.equal(await fs.readFile(path.join(root, 'boards/board-12/user-document.txt'), 'utf8'), 'keep');
    const metadata = JSON.parse(await fs.readFile(path.join(root, 'boards/board-12/board.json'), 'utf8'));
    assert.equal(metadata.links.plan, 'https://plan.test/project/DEMO/view/12');
    assert.equal(Object.hasOwn(metadata.links, 'files'), false);
    assert.equal(metadata.board.name, 'Renamed board');
    await fs.mkdir(path.join(root, 'other'));
    await fs.symlink(path.join(root, 'other'), path.join(root, 'boards/board-13'));
    value.requestedResources = ['board:13']; value.boards[0].id = 13; value.boards[0].resource = 'board:13';
    await assert.rejects(provisionBoards(config, value, workspace), /real project-owned/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
