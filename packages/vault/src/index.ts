export { VaultError } from './errors';
export * from './paths';
export * from './markdown';
export * from './mime';
export {
  commitExternalChanges,
  commitVaultPaths,
  EXTERNAL_AUTHOR,
  PLAN_AUTHOR,
  fileAtRevision,
  fileHistory,
  type FileRevision,
  type GitAuthor,
} from './git';
export { extractText, isExtractable, type Extraction } from './extract';
export { extractPending, requeueInstalledExtractions } from './extraction-queue';
export {
  EXTERNAL_PROVENANCE,
  indexVaultPaths,
  rescanVault,
  sha256Of,
  walkVault,
  type VaultWriteProvenance,
} from './indexer';
export {
  belowPattern,
  findEntry,
  moveEntries,
  pathOrBelow,
  resolveVaultPath,
  type VaultEntryRow,
} from './store';
export {
  assertNoSymlink,
  copyVaultFolder,
  createVaultFolder,
  listSyncConflicts,
  listTrash,
  MAX_NOTE_BYTES,
  moveVaultPath,
  readVaultFile,
  restoreVaultPath,
  trashVaultPath,
  writeVaultFile,
  type SyncConflict,
  type TrashedItem,
} from './files';
export { startVaultWatcher, DEFAULT_WATCHER_OPTIONS, type VaultWatcher } from './watcher';
