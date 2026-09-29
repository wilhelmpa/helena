import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { db, project, vaultEntry } from '@repo/db';
import { and, eq, like } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { canAccess, vaultScope } from '#modules/knowledge/scope';
import { joinPath, relativePath, safeFileName } from '#modules/project-files/paths';
import { homeRoot, projectRoot, projectVaultPath } from '#modules/project-files/roots';
import { describeVaultFile, writeUniqueFile } from '#modules/project-files/service';
import { DuplicateReceipt, requireReceipt, uploadReceipt } from '#modules/receipts/receipts';
import type { ToolCaller } from '../tools';

const MAX_BYTES = 50 * 1024 * 1024;

export interface DriveVaultInput {
  stream: Readable;
  fileId: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  folder: string;
  asReceipt: boolean;
}

function target(caller: ToolCaller, folder: string) {
  const safe = relativePath(folder);
  if (safe === 'Private' || safe.startsWith('Private/'))
    throw new HttpError(403, 'Private is unavailable to agents.');
  if (safe === 'Home' || safe.startsWith('Home/')) {
    return { root: homeRoot('home'), folder: safe === 'Home' ? '' : safe.slice(5) };
  }
  const prefix = `${projectVaultPath(caller.project.key)}/`;
  if (safe.startsWith('Projects/') && !safe.startsWith(prefix))
    throw new HttpError(403, 'Another project is outside your vault access.');
  return {
    root: projectRoot(caller.project.key),
    folder: safe.startsWith(prefix) ? safe.slice(prefix.length) : safe,
  };
}

async function collect(stream: Readable): Promise<{ bytes: Buffer; sha256: string; size: number }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'volition-drive-'));
  const file = path.join(dir, 'original');
  const handle = await open(file, 'wx', 0o600);
  const hash = createHash('sha256');
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > MAX_BYTES) {
        stream.destroy();
        throw new HttpError(413, 'Drive file exceeds the 50 MB limit.');
      }
      hash.update(bytes);
      await handle.writeFile(bytes);
    }
    await handle.close();
    return { bytes: await readFile(file), sha256: hash.digest('hex'), size };
  } finally {
    await handle.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

export async function saveDriveToVault(caller: ToolCaller, input: DriveVaultInput) {
  const destination = target(caller, input.folder);
  if (input.asReceipt && destination.root.name !== 'vault')
    throw new HttpError(403, 'Receipts belong to the current project.');
  const vaultPath = joinPath(destination.root.vaultPath!, destination.folder);
  const scope = await vaultScope({ id: caller.agent.userId }, true);
  if (!canAccess(scope, vaultPath, 'write'))
    throw new HttpError(403, 'This folder is outside your vault access.');
  const { bytes, sha256, size } = await collect(input.stream);
  const name = safeFileName(input.name);
  if (input.asReceipt) {
    const [row] = await db
      .select({ id: project.id, teamId: project.teamId, key: project.key })
      .from(project)
      .where(eq(project.id, caller.project.id));
    if (!row || row.key !== caller.project.key) throw new HttpError(403, 'Project access denied.');
    try {
      const receipt = await uploadReceipt(
        row,
        new File([bytes], name, { type: input.mimeType }),
        caller.agent.userId,
        {
          source: `Google Drive ${input.fileId}`,
          fileDate: input.modifiedTime,
          actorRef: `agent:${caller.agent.id}`,
          runId: caller.run?.id ?? null,
        },
      );
      return {
        vaultPath: receipt.vaultPath,
        sha256,
        size,
        mimeType: input.mimeType,
        link: `/projects/${encodeURIComponent(row.key)}/files/raw?path=${encodeURIComponent(receipt.vaultPath.slice(projectVaultPath(row.key).length + 1))}`,
        receiptId: receipt.id,
        duplicate: false,
      };
    } catch (error) {
      if (!(error instanceof DuplicateReceipt)) throw error;
      const receipt = await requireReceipt(row.id, error.existingId);
      const relative = receipt.vaultPath.slice(projectVaultPath(row.key).length + 1);
      return {
        vaultPath: receipt.vaultPath,
        sha256,
        size,
        mimeType: input.mimeType,
        link: `/projects/${encodeURIComponent(row.key)}/files/raw?path=${encodeURIComponent(relative)}`,
        receiptId: receipt.id,
        duplicate: true,
      };
    }
  }
  const known = await db
    .select({ path: vaultEntry.path })
    .from(vaultEntry)
    .where(
      and(eq(vaultEntry.sha256, sha256), like(vaultEntry.path, `${destination.root.vaultPath}/%`)),
    );
  for (const entry of known) {
    if (!entry.path.startsWith(`${destination.root.vaultPath}/`)) continue;
    const relative = entry.path.slice(destination.root.vaultPath!.length + 1);
    const existing = await describeVaultFile(destination.root, relative).catch(() => null);
    if (existing?.sha256 === sha256) {
      const link =
        destination.root.name === 'home'
          ? `/files/raw?root=home&path=${encodeURIComponent(relative)}`
          : `/projects/${encodeURIComponent(caller.project.key)}/files/raw?path=${encodeURIComponent(relative)}`;
      return {
        vaultPath: entry.path,
        sha256,
        size,
        mimeType: existing.contentType,
        link,
        duplicate: true,
      };
    }
  }
  const relative = await writeUniqueFile(destination.root, destination.folder, name, bytes, {
    ref: `agent:${caller.agent.id}`,
    runId: caller.run?.id ?? null,
  });
  const saved = joinPath(destination.root.vaultPath!, relative);
  const link =
    destination.root.name === 'home'
      ? `/files/raw?root=home&path=${encodeURIComponent(relative)}`
      : `/projects/${encodeURIComponent(caller.project.key)}/files/raw?path=${encodeURIComponent(relative)}`;
  return { vaultPath: saved, sha256, size, mimeType: input.mimeType, link, duplicate: false };
}
