import path from 'node:path';

// Files whose text is their content. They are also the files the vault's git history
// tracks (see the .gitignore the setup script writes).
const TEXT_EXTENSIONS = new Set(['.md', '.canvas', '.txt', '.csv', '.json', '.yaml', '.yml']);

export function isTextFile(relative: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase());
}
