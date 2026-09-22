import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from './atomic-json.mjs';

async function safeChild(parent, name) {
  const target = path.join(parent, name);
  await fs.mkdir(target, { recursive: true, mode: 0o750 });
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(target) !== target) {
    throw new Error('Board workspace must be a real project-owned directory');
  }
  return target;
}

export async function provisionBoards(config, envelope, workspace, ensureBoardFiles) {
  const requested = new Set(envelope.requestedResources);
  const boards = (envelope.boards ?? []).filter((board) => requested.has(board.resource));
  if (boards.length === 0) return [];
  const root = await safeChild(workspace.hostPath, 'boards');
  const results = [];
  for (const board of boards) {
    if (!Number.isSafeInteger(board.id) || board.id < 1 || board.resource !== `board:${board.id}`) {
      throw new Error('Invalid board resource');
    }
    // Names may change; the stable numeric id keeps paths and links intact.
    const name = `board-${board.id}`;
    const directory = await safeChild(root, name);
    const boardPath = `${workspace.containerPath}/boards/${name}`;
    const files = await ensureBoardFiles(workspace.slug, board.id);
    const plan = config.planUrl ? new URL(`/project/${encodeURIComponent(envelope.project.key)}/view/${board.id}`, config.planUrl).toString() : null;
    const metadata = {
      schemaVersion: 1, project: envelope.project, board,
      links: { plan, files: files.url ?? null }, workspace: boardPath,
      guidance: 'Use exact API-returned document ids and project-scoped ticket sequence numbers. Store deliverables in Nextcloud, link both directions, verify every link before marking done. Never put secrets in this registry.',
    };
    await writeJsonAtomic(path.join(directory, 'board.json'), metadata);
    const code = config.codeUrl ? new URL(config.codeUrl) : null;
    code?.searchParams.set('folder', boardPath);
    results.push({ kind: board.resource, id: boardPath, ...(code ? { url: code.toString() } : {}) });
    results.push({ kind: `${board.resource}:files`, id: files.id, ...(files.url ? { url: files.url } : {}) });
  }
  return results;
}
