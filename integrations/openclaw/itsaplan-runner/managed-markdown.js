import { constants } from 'node:fs';
import { mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';

export function safeManagedMarkdownPath(file) {
  const relative = String(file?.path ?? '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '');
  if (!relative || path.posix.isAbsolute(relative) || relative.split('/').includes('..')) {
    throw new Error(`Invalid managed file path: ${relative || '<empty>'}`);
  }
  if (!relative.toLowerCase().endsWith('.md')) {
    throw new Error(`Managed file must be Markdown: ${relative}`);
  }
  if (file.kind === 'memory' && relative !== 'MEMORY.md' && !relative.startsWith('memory/')) {
    throw new Error(`Memory file must be MEMORY.md or under memory/: ${relative}`);
  }
  return relative;
}

export async function writeManagedMarkdown(workspace, file) {
  const relative = safeManagedMarkdownPath(file);
  const workspaceRoot = await realpath(workspace);
  const rootPrefix = `${workspaceRoot}${path.sep}`;
  const target = path.resolve(workspaceRoot, relative);
  if (!target.startsWith(rootPrefix))
    throw new Error(`Managed file escapes workspace: ${relative}`);

  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  if (realParent !== workspaceRoot && !realParent.startsWith(rootPrefix)) {
    throw new Error(`Managed file parent escapes workspace: ${relative}`);
  }

  let handle;
  try {
    handle = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(String(file.content ?? ''), 'utf8');
    await handle.chmod(0o600);
  } finally {
    await handle?.close();
  }
}
