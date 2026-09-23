import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { AREA_FOLDER, RESERVED_AREA_FOLDERS } from "./validation.mjs";

export function validAreas(areas) {
  return (Array.isArray(areas) ? areas : []).filter(
    (area) =>
      area &&
      Number.isSafeInteger(area.id) &&
      area.id > 0 &&
      typeof area.folder === "string" &&
      AREA_FOLDER.test(area.folder) &&
      !RESERVED_AREA_FOLDERS.has(area.folder),
  );
}

async function exists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function isDirectory(target) {
  try {
    const stat = await fs.lstat(target);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function oneLine(value) {
  return value.replace(/[\s\p{Cc}]+/gu, " ").trim();
}

function instructions(project, area) {
  const name = oneLine(area.name);
  return [
    `# Area: ${name}`,
    "",
    `This folder belongs to the area "${name}" of the project "${oneLine(project.name)}" (${project.key}) in Plan.`,
    "Agent runs for the tasks of this area start here. Keep the files of this area's work in this folder.",
    "The project-wide instructions and links are in ../AGENTS.md and ../PROJECT.json.",
    `The project's vault folder (the Files page in Plan) has a folder ${area.folder}/ for this area as well.`,
    "",
  ].join("\n");
}

// Written once: a file an agent or a person changed afterwards is theirs.
async function writeInstructions(directory, project, area) {
  let handle;
  try {
    handle = await fs.open(
      path.join(directory, "AGENTS.md"),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o640,
    );
  } catch (error) {
    if (error?.code === "EEXIST") return;
    throw error;
  }
  try {
    await handle.writeFile(instructions(project, area), "utf8");
  } finally {
    await handle.close();
  }
}

// Keeps one folder per area below each root: the project workspace and the project's
// vault folder. `previous` is the area list of the last successful run. The folders of an
// area missing from `areas` go to the trash, and those of an area whose folder changed are
// moved, unless the new folder exists already; that one is kept and the move reported.
// Folders that belong to no area are left alone.
export async function provisionAreas({ project, areas, previous, roots, quarantine }) {
  const current = new Map(areas.map((area) => [area.id, area]));
  const quarantined = [];
  for (const area of previous.filter((entry) => !current.has(entry.id))) {
    for (const root of roots) {
      const moved = await quarantine(
        path.join(root.path, area.folder),
        root.path,
        `area-${area.id}-${root.kind}`,
      );
      if (moved) quarantined.push(moved);
    }
  }

  let moves = [];
  for (const area of previous) {
    const next = current.get(area.id);
    if (!next || next.folder === area.folder) continue;
    for (const root of roots) {
      const source = path.join(root.path, area.folder);
      if (await isDirectory(source)) {
        moves.push({ area: next, root, from: area.folder, source, target: path.join(root.path, next.folder) });
      }
    }
  }
  // A move whose target is the old folder of another area waits for that area's move.
  while (moves.length) {
    const waiting = [];
    for (const move of moves) {
      if (await exists(move.target)) waiting.push(move);
      else await fs.rename(move.source, move.target);
    }
    if (waiting.length === moves.length) break;
    moves = waiting;
  }
  const warnings = moves.map(
    (move) =>
      `The ${move.root.kind} folder ${move.from} of the area ${oneLine(move.area.name)} was not moved: ${move.area.folder} exists already.`,
  );

  for (const area of areas) {
    for (const root of roots) {
      const directory = await root.ensure(path.join(root.path, area.folder));
      if (root.kind === "workspace") await writeInstructions(directory, project, area);
    }
  }
  return {
    areas: areas.map(({ id, name, folder }) => ({ id, name, folder })),
    quarantined,
    warnings,
  };
}

// The areas whose folders exist below every root, for the worker's reconciliation.
export async function presentAreas(areas, roots) {
  const present = [];
  for (const area of validAreas(areas)) {
    const found = await Promise.all(roots.map((root) => isDirectory(path.join(root, area.folder))));
    if (found.every(Boolean)) present.push({ id: area.id, folder: area.folder });
  }
  return present;
}
