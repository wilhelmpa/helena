import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cleanupBoardFileFolders } from "../cleanup-board-file-folders.mjs";

test("dry run, empty-only removal and repeat leave files and canvases intact", async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "volition-board-cleanup-"));
  try {
    const project = path.join(vault, "Projects", "DEMO");
    const boardFiles = path.join(project, "Files", "Boards");
    const canvas = path.join(project, "Boards", "planning.canvas");
    await fs.mkdir(path.join(boardFiles, "board-1"), { recursive: true });
    await fs.mkdir(path.join(boardFiles, "board-2"));
    await fs.mkdir(path.dirname(canvas), { recursive: true });
    await fs.writeFile(path.join(boardFiles, "board-2", "keep.txt"), "keep");
    await fs.writeFile(canvas, "canvas");

    const preview = await cleanupBoardFileFolders(vault);
    assert.deepEqual(preview.empty, [path.join(boardFiles, "board-1")]);
    assert.deepEqual(preview.nonEmpty, [path.join(boardFiles, "board-2")]);
    assert.deepEqual(preview.removed, []);
    assert.equal((await fs.readdir(boardFiles)).length, 2);

    const applied = await cleanupBoardFileFolders(vault, { apply: true });
    assert.deepEqual(applied.removed, [path.join(boardFiles, "board-1")]);
    assert.deepEqual(applied.nonEmpty, [path.join(boardFiles, "board-2")]);
    assert.deepEqual((await cleanupBoardFileFolders(vault, { apply: true })).removed, []);
    assert.equal(await fs.readFile(canvas, "utf8"), "canvas");
    assert.equal(await fs.readFile(path.join(boardFiles, "board-2", "keep.txt"), "utf8"), "keep");

    await fs.rm(path.join(boardFiles, "board-2", "keep.txt"));
    assert.deepEqual((await cleanupBoardFileFolders(vault, { apply: true })).removed, [
      path.join(boardFiles, "board-2"),
      boardFiles,
    ]);
    assert.deepEqual((await cleanupBoardFileFolders(vault, { apply: true })).removed, []);
    assert.equal(await fs.readFile(canvas, "utf8"), "canvas");
  } finally {
    await fs.rm(vault, { recursive: true, force: true });
  }
});

test("other names and symlinked board folders are never followed", async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "volition-board-cleanup-"));
  try {
    const boards = path.join(vault, "Projects", "DEMO", "Files", "Boards");
    const outside = path.join(vault, "outside");
    await fs.mkdir(boards, { recursive: true });
    await fs.mkdir(outside);
    await fs.mkdir(path.join(boards, "board-name"));
    await fs.symlink(outside, path.join(boards, "board-4"));
    const result = await cleanupBoardFileFolders(vault, { apply: true });
    assert.deepEqual(result.removed, []);
    assert.deepEqual((await fs.readdir(boards)).sort(), ["board-4", "board-name"]);
  } finally {
    await fs.rm(vault, { recursive: true, force: true });
  }
});
