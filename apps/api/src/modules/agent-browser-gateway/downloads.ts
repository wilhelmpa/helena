import { homeRoot, projectRoot } from '#modules/project-files/roots';
import { writeUniqueFile } from '#modules/project-files/service';

// A file the project browser downloaded (design §4: "Downloads landen in
// vault/Projects/<KEY>/Inbox/"), written by Helena, which owns the vault, rather than by the
// browser user, which may not write there. Home's own browser files into Home/Inbox. A name
// already taken gets a number, never replaces a file.
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export async function saveDownload(
  project: { key: string } | null,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  const root = project ? projectRoot(project.key) : homeRoot('home');
  const relative = await writeUniqueFile(root, 'Inbox', fileName, bytes);
  return `${root.vaultPath}/${relative}`;
}
