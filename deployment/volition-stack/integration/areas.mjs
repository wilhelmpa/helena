import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { AREA_FOLDER, RESERVED_AREA_FOLDERS } from "./validation.mjs";

const ROOT_KINDS = new Set(["workspace", "files"]);

// The area entries of a registry. `adopted` names the roots where the area's folder
// existed before the provisioner claimed it; the provisioner never moves or trashes
// those.
export function validAreas(areas) {
  return (Array.isArray(areas) ? areas : []).flatMap((area) =>
    area &&
    Number.isSafeInteger(area.id) &&
    area.id > 0 &&
    typeof area.folder === "string" &&
    AREA_FOLDER.test(area.folder) &&
    !RESERVED_AREA_FOLDERS.has(area.folder)
      ? [
          {
            id: area.id,
            name: typeof area.name === "string" ? area.name : "",
            folder: area.folder,
            adopted: Array.isArray(area.adopted)
              ? area.adopted.filter((kind) => ROOT_KINDS.has(kind))
              : [],
          },
        ]
      : [],
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

// The first move of a cycle of moves, where each target is the source of the next one:
// areas that exchanged their folders.
function cycleStart(moves, target) {
  const bySource = new Map(moves.map((entry) => [entry.folder, entry]));
  for (const start of moves) {
    let next = bySource.get(target(start));
    for (let steps = 0; next && next !== start && steps < moves.length; steps++) {
      next = bySource.get(target(next));
    }
    if (next === start) return start;
  }
  return null;
}

// Keeps one folder per area below each root: the project workspace and the project's
// vault folder. `previous` is the registry's area list; `record` stores it again after
// every folder that was trashed or moved, so a retry continues where a failed run
// stopped. The folders of an area missing from `areas` go to the trash. Those of an
// area whose folder changed are moved, unless the new folder exists already; then both
// stay and the move is reported. A folder that existed before its area claimed it is
// used as it is: nothing is written into it, and it is never moved or trashed. Folders
// that belong to no area are left alone.
export async function provisionAreas({ project, areas, previous, roots, quarantine, record }) {
  const current = new Map(areas.map((area) => [area.id, area]));
  let registered = previous;
  const save = async (next) => {
    registered = next;
    await record(registered);
  };
  const owns = (entry, root) => !entry.adopted.includes(root.kind);

  const quarantined = [];
  for (const entry of previous.filter((area) => !current.has(area.id))) {
    for (const root of roots.filter((candidate) => owns(entry, candidate))) {
      const moved = await quarantine(
        path.join(root.path, entry.folder),
        root.path,
        `area-${entry.id}-${root.kind}`,
      );
      if (moved) quarantined.push(moved);
    }
    await save(registered.filter((area) => area.id !== entry.id));
  }

  const target = (entry) => current.get(entry.id).folder;
  const parking = (entry) => `.area-${entry.id}-moving`;
  const blocked = async (entry) => {
    for (const root of roots.filter((candidate) => owns(entry, candidate))) {
      if (await exists(path.join(root.path, target(entry)))) return true;
    }
    return false;
  };
  // A folder parked by a run that failed afterwards is moved on from where it is.
  const relocate = async (entry, folder) => {
    for (const root of roots.filter((candidate) => owns(entry, candidate))) {
      const parked = path.join(root.path, parking(entry));
      const source = (await isDirectory(parked)) ? parked : path.join(root.path, entry.folder);
      const destination = path.join(root.path, folder);
      if (source !== destination && (await isDirectory(source)) && !(await exists(destination))) {
        await fs.rename(source, destination);
      }
    }
  };
  const parked = new Set();
  let moves = registered.filter((entry) => current.has(entry.id) && target(entry) !== entry.folder);
  while (moves.length) {
    const waiting = [];
    for (const entry of moves) {
      if (await blocked(entry)) {
        waiting.push(entry);
        continue;
      }
      await relocate(entry, target(entry));
      // Where the old folder was found rather than created, it stays, and the new one is
      // the area's own unless it exists as well.
      const adopted = [];
      for (const root of roots.filter((candidate) => !owns(entry, candidate))) {
        if (await exists(path.join(root.path, target(entry)))) adopted.push(root.kind);
      }
      await save(
        registered.map((area) =>
          area.id === entry.id ? { ...area, folder: target(entry), adopted } : area,
        ),
      );
    }
    if (waiting.length === moves.length) {
      const start = cycleStart(waiting, target);
      if (!start || parked.has(start.id)) break;
      parked.add(start.id);
      await relocate(start, parking(start));
    }
    moves = waiting;
  }
  for (const entry of moves.filter((candidate) => parked.has(candidate.id))) {
    await relocate(entry, entry.folder);
  }
  const warnings = moves.map(
    (entry) =>
      `The folder ${entry.folder} of the area ${oneLine(current.get(entry.id).name)} was not moved: ${target(entry)} exists already.`,
  );
  const unmoved = new Set(moves.map((entry) => entry.id));

  // Whether a folder existed before is decided, and recorded, before anything is
  // created, so a retry does not take a folder of its own for one it found.
  for (const area of areas) {
    const entry = registered.find((candidate) => candidate.id === area.id);
    if (entry?.folder === area.folder) continue;
    const adopted = [];
    for (const root of roots) {
      if (!(await exists(path.join(root.path, area.folder)))) continue;
      adopted.push(root.kind);
      if (!unmoved.has(area.id)) {
        warnings.push(
          `The ${root.kind} folder ${area.folder} existed already. The area ${oneLine(area.name)} uses it and never moves or trashes it.`,
        );
      }
    }
    await save([
      ...registered.filter((candidate) => candidate.id !== area.id),
      { id: area.id, name: area.name, folder: area.folder, adopted },
    ]);
  }
  const provisioned = areas.map((area) => ({
    ...registered.find((candidate) => candidate.id === area.id),
    name: area.name,
  }));
  for (const entry of provisioned) {
    for (const root of roots) {
      const directory = await root.ensure(path.join(root.path, entry.folder));
      if (root.kind === "workspace" && owns(entry, root)) {
        await writeInstructions(directory, project, entry);
      }
    }
  }
  return { areas: provisioned, quarantined, warnings };
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
