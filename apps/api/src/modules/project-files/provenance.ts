import { recordActorWrite, reindexVaultPaths, type CaptureActor } from '@helena/knowledge';

export type FileActor = CaptureActor;

export async function recordFileWrite(paths: string[], actor: FileActor = { ref: 'extern' }) {
  await recordActorWrite(paths, 'Update project files', actor);
  await reindexVaultPaths(paths);
}
