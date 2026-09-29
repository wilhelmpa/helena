import { and, asc, eq, isNull, like } from 'drizzle-orm';
import { db, helenaBrowserTaskRun, project } from '@repo/db';
import {
  HOME_DIR,
  joinVaultPath,
  projectFolder,
  readVaultFile,
  resolveVaultPath,
  sha256Of,
  VaultError,
  writeVaultFile,
} from '@repo/vault';
import { recordActorWrite, reindexVaultPaths, type CaptureActor } from '@helena/knowledge';

// The final frame of a browser run (jev-browser's throwaway browser has no live view) is a
// file in the vault, not a picture in the database (owner, 2026-09-29: "kein zweiter
// Speicher"): Projects/<KEY>/Files/Browser/<run id>.<png|jpg>, Home/Files/Browser for Home's
// own browser. The row keeps its path and hash (final_frame_path, final_frame_sha256).

export const BROWSER_FRAMES_FOLDER = 'Files/Browser';

// What the gateway may send: a PNG or JPEG data: URL, at most this long.
export const MAX_FRAME_DATA_URL = 600_000;
const DATA_URL = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/;

export interface FrameOwner {
  id: number;
  projectId: number | null;
  agentId: number | null;
  runId: number | null;
}

// The picture of a data: URL, or null when it is not a PNG or JPEG one of a sane size.
export function parseFrame(dataUrl: unknown): { extension: 'png' | 'jpg'; bytes: Buffer } | null {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_FRAME_DATA_URL) return null;
  const match = DATA_URL.exec(dataUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.length === 0) return null;
  return { extension: match[1] === 'png' ? 'png' : 'jpg', bytes };
}

async function frameFolder(projectId: number | null): Promise<string> {
  if (projectId === null) return joinVaultPath(HOME_DIR, BROWSER_FRAMES_FOLDER);
  const [row] = await db
    .select({ key: project.key })
    .from(project)
    .where(eq(project.id, projectId));
  if (!row) throw new VaultError(404, 'Project not found');
  return joinVaultPath(projectFolder(row.key), BROWSER_FRAMES_FOLDER);
}

// Writes the frame as <id>.<ext>, or "<id> (2).<ext>" … when that name holds something else.
// A file there with the same bytes (an earlier, interrupted write of this run) is taken as
// it is, so writing a frame twice leaves one file.
async function writeFrameFile(folder: string, stem: string, extension: string, bytes: Buffer) {
  const hash = sha256Of(bytes);
  for (let number = 1; number <= 100; number += 1) {
    const name = number === 1 ? `${stem}.${extension}` : `${stem} (${number}).${extension}`;
    const candidate = joinVaultPath(folder, name);
    try {
      await writeVaultFile(candidate, bytes, null);
      return { path: candidate, sha256: hash, written: true };
    } catch (error) {
      if (!(error instanceof VaultError && error.code === 'exists')) throw error;
      const existing = await readVaultFile(candidate, bytes.length + 1).catch(() => null);
      if (existing?.sha256 === hash) return { path: candidate, sha256: hash, written: false };
    }
  }
  throw new VaultError(409, 'No free file name is left for this frame');
}

// Stores a run's final frame in the vault and returns where. Written in the agent's name
// when an agent ran it, else Helena's ('system'); either way the file shows as an agent's
// (packages/vault origin: Files/Browser).
export async function storeFinalFrame(
  owner: FrameOwner,
  dataUrl: unknown,
): Promise<{ path: string; sha256: string } | null> {
  const frame = parseFrame(dataUrl);
  if (!frame) return null;
  const folder = await frameFolder(owner.projectId);
  const file = await writeFrameFile(folder, String(owner.id), frame.extension, frame.bytes);
  if (file.written) {
    const actor: CaptureActor = owner.agentId
      ? { ref: `agent:${owner.agentId}`, runId: owner.runId }
      : { ref: 'system' };
    await recordActorWrite([file.path], `Browser run ${owner.id}: final frame`, actor);
    await reindexVaultPaths([file.path]).catch(() => undefined);
  }
  return { path: file.path, sha256: file.sha256 };
}

// Stores the frame and points the row at it. A frame that cannot be written is left out
// (the run's result stands without it) rather than kept in the database.
export async function attachFinalFrame(owner: FrameOwner, dataUrl: unknown): Promise<void> {
  if (!parseFrame(dataUrl)) return;
  try {
    const file = await storeFinalFrame(owner, dataUrl);
    if (!file) return;
    await db
      .update(helenaBrowserTaskRun)
      .set({ finalFramePath: file.path, finalFrameSha256: file.sha256 })
      .where(eq(helenaBrowserTaskRun.id, owner.id));
  } catch (error) {
    console.error(`[browser-task] final frame of run ${owner.id} not stored:`, error);
  }
}

// Where the frame is now: its path while the file exists, else where it was moved to, else
// null (deleted).
export async function currentFramePath(row: {
  finalFramePath: string | null;
  finalFrameSha256: string | null;
}): Promise<string | null> {
  if (!row.finalFramePath) return null;
  return resolveVaultPath(row.finalFramePath, row.finalFrameSha256);
}

export interface FrameMigrationReport {
  apply: boolean;
  // Runs whose frame is still a data: URL in the database.
  pending: { id: number; projectId: number | null; bytes: number }[];
  migrated: { id: number; path: string }[];
  // Data that is not a PNG or JPEG data: URL; left as it is.
  invalid: { id: number }[];
  failed: { id: number; error: string }[];
}

// Moves the frames runs kept in the database into the vault: each becomes its file, the row
// points at it and its data: URL is cleared. Repeatable: a moved row has no data: URL left,
// and an interrupted run's file is taken over by the next.
export async function moveFramesToVault({
  apply = false,
}: { apply?: boolean } = {}): Promise<FrameMigrationReport> {
  const rows = await db
    .select({
      id: helenaBrowserTaskRun.id,
      projectId: helenaBrowserTaskRun.projectId,
      agentId: helenaBrowserTaskRun.agentId,
      runId: helenaBrowserTaskRun.runId,
      finalFrame: helenaBrowserTaskRun.finalFrame,
    })
    .from(helenaBrowserTaskRun)
    .where(
      and(
        like(helenaBrowserTaskRun.finalFrame, 'data:%'),
        isNull(helenaBrowserTaskRun.finalFramePath),
      ),
    )
    .orderBy(asc(helenaBrowserTaskRun.id));
  const report: FrameMigrationReport = {
    apply,
    pending: [],
    migrated: [],
    invalid: [],
    failed: [],
  };
  for (const row of rows) {
    const frame = parseFrame(row.finalFrame);
    if (!frame) {
      report.invalid.push({ id: row.id });
      continue;
    }
    report.pending.push({ id: row.id, projectId: row.projectId, bytes: frame.bytes.length });
    if (!apply) continue;
    try {
      const file = await storeFinalFrame(row, row.finalFrame);
      if (!file) continue;
      await db
        .update(helenaBrowserTaskRun)
        .set({ finalFramePath: file.path, finalFrameSha256: file.sha256, finalFrame: null })
        .where(
          and(eq(helenaBrowserTaskRun.id, row.id), isNull(helenaBrowserTaskRun.finalFramePath)),
        );
      report.migrated.push({ id: row.id, path: file.path });
    } catch (error) {
      report.failed.push({
        id: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}
