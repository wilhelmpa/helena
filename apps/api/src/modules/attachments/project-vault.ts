import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { db, project } from '@repo/db';
import { eq } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { getObject } from '#shared/s3';
import { projectRoot, vaultDirectory } from '#modules/project-files/roots';
import { resolveVaultFile } from '#modules/project-files/resolver';
import { sha256, writeUniqueFile } from '#modules/project-files/service';
import type { FileActor } from '#modules/project-files/provenance';

export interface StoredProjectFile {
  s3Key: string | null;
  vaultPath: string | null;
  sha256: string | null;
  sizeBytes: number;
}

export async function projectFileRoot(projectId: number) {
  const [row] = await db
    .select({ key: project.key })
    .from(project)
    .where(eq(project.id, projectId));
  if (!row) throw new HttpError(404, 'Project not found');
  return projectRoot(row.key);
}

export async function storeProjectFile(
  projectId: number,
  folder: string,
  filename: string,
  bytes: Uint8Array,
  actor?: FileActor,
) {
  const root = await projectFileRoot(projectId);
  const relative = await writeUniqueFile(root, folder, filename, bytes, actor);
  return {
    s3Key: null,
    vaultPath: `${root.vaultPath}/${relative}`,
    sha256: sha256(bytes),
    filename: path.basename(relative),
    sizeBytes: bytes.length,
  };
}

export async function currentProjectFile(
  projectId: number,
  row: StoredProjectFile,
): Promise<string | null> {
  if (!row.vaultPath) return null;
  const root = await projectFileRoot(projectId);
  if (!row.vaultPath.startsWith(`${root.vaultPath}/`)) throw new HttpError(404, 'File not found');
  return resolveVaultFile({
    ...row,
    vaultPath: row.vaultPath,
    searchFolders: [path.posix.dirname(row.vaultPath), root.vaultPath!],
  });
}

export async function readProjectFileBytes(
  projectId: number,
  row: StoredProjectFile,
): Promise<Buffer> {
  if (row.vaultPath) {
    const current = await currentProjectFile(projectId, row);
    if (!current) throw new HttpError(404, 'The attachment file is missing');
    return readFile(path.join(vaultDirectory(), current));
  }
  if (!row.s3Key) throw new HttpError(404, 'The attachment file is missing');
  const object = await getObject(row.s3Key).catch(() => null);
  if (!object) throw new HttpError(404, 'The attachment file is missing');
  return Buffer.from(await new Response(object.body).arrayBuffer());
}
