import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { splitNote } from '../packages/vault/src/markdown';

// Read-only inventory. Usage: PROJECT_VAULT_ROOT=/private/test-vault bun scripts/second-brain-dry-run.ts
// Prints proposals, never changes files. A real migration requires a separate approval.
const root = process.env.PROJECT_VAULT_ROOT;
if (!root) throw new Error('PROJECT_VAULT_ROOT is required');

async function* notes(folder: string): AsyncGenerator<string> {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const absolute = path.join(folder, entry.name);
    if (entry.isDirectory()) yield* notes(absolute);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) yield absolute;
  }
}

for await (const absolute of notes(root)) {
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (!relative.startsWith('Projects/') && !relative.startsWith('Home/')) continue;
  const note = splitNote(await readFile(absolute, 'utf8'));
  if (note.frontmatter.generated === true) continue;
  const project = /^Projects\/([^/]+)\//.exec(relative)?.[1] ?? null;
  const proposal = {
    type: 'knowledge',
    schema_version: 1,
    status: 'draft',
    project,
    tags: [],
    source: '',
    origin: 'human',
  };
  const missing = Object.fromEntries(
    Object.entries(proposal).filter(([key]) => !(key in note.frontmatter)),
  );
  if (Object.keys(missing).length) console.log(JSON.stringify({ path: relative, add: missing }));
}
