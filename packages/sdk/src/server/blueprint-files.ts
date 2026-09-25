// The directory form of a Helena project blueprint (format: ../blueprints.ts):
//
//   helena.blueprint.json   the manifest: everything but the files below
//   instructions.md         the project-wide instructions of the project's agents
//   knowledge/**.md         files placed below the project's knowledge folder Projects/<KEY>/
//   templates/**.md         note templates placed below the vault's Templates/ folder
//   boards/<name>.json      note boards: { "name", "stickers", "edges" }
//
// Bun or Node (file system only): the entry `@helena/sdk/blueprints`. The one-document JSON
// form is what the rest of Helena reads.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  BLUEPRINT_MANIFEST,
  validateBlueprint,
  type BlueprintBoard,
  type BlueprintFile,
  type ProjectBlueprint,
} from '../blueprints';

const INSTRUCTIONS_FILE = 'instructions.md';

// Every .md file below a folder, by its path relative to it, sorted.
function markdownFiles(root: string): BlueprintFile[] {
  if (!existsSync(root)) return [];
  const out: BlueprintFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.md')) {
        out.push({
          path: relative(root, path).split(sep).join('/'),
          content: readFileSync(path, 'utf8'),
        });
      }
    }
  };
  walk(root);
  return out;
}

function boards(root: string): BlueprintBoard[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(root, name), 'utf8')) as BlueprintBoard);
}

// Reads a blueprint directory into the one-document form and checks it.
export function readBlueprintDir(dir: string): ProjectBlueprint {
  const manifest = JSON.parse(
    readFileSync(join(dir, BLUEPRINT_MANIFEST), 'utf8'),
  ) as ProjectBlueprint;
  const instructions = join(dir, INSTRUCTIONS_FILE);
  const blueprint: ProjectBlueprint = {
    ...manifest,
    project: {
      ...manifest.project,
      instructions: existsSync(instructions)
        ? readFileSync(instructions, 'utf8').trim()
        : (manifest.project?.instructions ?? ''),
    },
    knowledge: {
      project: markdownFiles(join(dir, 'knowledge')),
      templates: markdownFiles(join(dir, 'templates')),
    },
    boards: boards(join(dir, 'boards')),
    areas: manifest.areas ?? [],
    agents: manifest.agents ?? [],
    goals: manifest.goals ?? [],
    routines: manifest.routines ?? [],
  };
  const problems = validateBlueprint(blueprint);
  if (problems.length > 0) {
    throw new Error(`Invalid blueprint ${dir}:\n- ${problems.join('\n- ')}`);
  }
  return blueprint;
}
