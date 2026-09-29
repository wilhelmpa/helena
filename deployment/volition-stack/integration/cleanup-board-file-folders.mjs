import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BOARD_DIRECTORY = /^board-[0-9]+$/;

async function realDirectory(directory) {
  try {
    const stat = await fs.lstat(directory);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function cleanupBoardFileFolders(vaultRoot, { apply = false } = {}) {
  if (!path.isAbsolute(vaultRoot) || !(await realDirectory(vaultRoot))) {
    throw new Error("Vault root must be an existing, absolute, real directory");
  }
  const result = { empty: [], nonEmpty: [], removed: [], failed: [] };
  const projectsRoot = path.join(vaultRoot, "Projects");
  if (!(await realDirectory(projectsRoot))) return result;

  for (const project of await fs.readdir(projectsRoot, { withFileTypes: true })) {
    if (!project.isDirectory() || project.isSymbolicLink()) continue;
    const projectRoot = path.join(projectsRoot, project.name);
    const filesRoot = path.join(projectRoot, "Files");
    const boardsRoot = path.join(filesRoot, "Boards");
    if (!(await realDirectory(projectRoot)) || !(await realDirectory(filesRoot)) || !(await realDirectory(boardsRoot))) continue;

    for (const entry of await fs.readdir(boardsRoot, { withFileTypes: true })) {
      if (!BOARD_DIRECTORY.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const directory = path.join(boardsRoot, entry.name);
      try {
        if (!(await realDirectory(directory))) continue;
        if ((await fs.readdir(directory)).length) {
          result.nonEmpty.push(directory);
        } else if (apply) {
          await fs.rmdir(directory);
          result.removed.push(directory);
        } else {
          result.empty.push(directory);
        }
      } catch (error) {
        if (error?.code === "ENOTEMPTY" || error?.code === "EEXIST") result.nonEmpty.push(directory);
        else result.failed.push({ path: directory, error: error.message });
      }
    }

    try {
      const remaining = await fs.readdir(boardsRoot);
      if (apply && remaining.length === 0) {
        await fs.rmdir(boardsRoot);
        result.removed.push(boardsRoot);
      } else if (!apply && remaining.length > 0 && remaining.every((name) => result.empty.includes(path.join(boardsRoot, name)))) {
        result.empty.push(boardsRoot);
      } else if (!apply && remaining.length === 0) {
        result.empty.push(boardsRoot);
      }
    } catch (error) {
      if (error?.code !== "ENOTEMPTY" && error?.code !== "EEXIST") {
        result.failed.push({ path: boardsRoot, error: error.message });
      }
    }
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const rootAt = args.indexOf("--vault-root");
  if (rootAt < 0 || !args[rootAt + 1] || args.length !== (apply ? 3 : 2)) {
    console.error("Usage: node cleanup-board-file-folders.mjs --vault-root /absolute/vault/path [--apply]");
    process.exitCode = 2;
  } else {
    const result = await cleanupBoardFileFolders(args[rootAt + 1], { apply });
    for (const directory of result.empty) console.log(`Would remove: ${directory}`);
    for (const directory of result.removed) console.log(`Removed: ${directory}`);
    for (const directory of result.nonEmpty) console.log(`Kept (not empty): ${directory}`);
    for (const failure of result.failed) console.error(`Failed: ${failure.path}: ${failure.error}`);
    if (result.failed.length) process.exitCode = 1;
  }
}
