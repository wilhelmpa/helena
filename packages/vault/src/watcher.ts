import { watch, type FSWatcher } from 'node:fs';
import { extractPending, requeueInstalledExtractions } from './extraction-queue';
import { commitExternalChanges } from './git';
import { indexVaultPaths, rescanVault } from './indexer';
import { isIgnoredPath, vaultRoot } from './paths';

export interface VaultWatcherOptions {
  // How long events are collected before the changed paths are indexed.
  debounceMs: number;
  // How long the vault has to be quiet before outside changes are committed.
  commitQuietMs: number;
  // How often the whole vault is compared with the index.
  rescanIntervalMs: number;
  // How often the extraction queue is checked.
  extractionIntervalMs: number;
}

export const DEFAULT_WATCHER_OPTIONS: VaultWatcherOptions = {
  debounceMs: 750,
  commitQuietMs: 10_000,
  rescanIntervalMs: 10 * 60_000,
  extractionIntervalMs: 5_000,
};

export interface VaultWatcher {
  stop(): void;
  // Resolves once everything queued so far is indexed. For tests.
  settled(): Promise<void>;
}

// Keeps the index in line with the vault: a recursive watch indexes what changes, a
// periodic rescan repairs what the watch missed (events lost while the process was down
// or on an overflow), outside changes are committed once the vault is quiet, and the
// extraction queue is worked through. Indexing and rescans run one at a time.
export function startVaultWatcher(
  options: VaultWatcherOptions = DEFAULT_WATCHER_OPTIONS,
): VaultWatcher {
  const root = vaultRoot();
  const pending = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let commitTimer: ReturnType<typeof setTimeout> | null = null;
  let extracting = false;
  let stopped = false;

  const run = (label: string, task: () => Promise<unknown>) => {
    chain = chain.then(task).then(
      () => undefined,
      (error) => console.error(`[vault] ${label} failed:`, error),
    );
    return chain;
  };

  const scheduleCommit = () => {
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      commitTimer = null;
      void run('commit', commitExternalChanges);
    }, options.commitQuietMs);
  };

  const flush = () => {
    flushTimer = null;
    const paths = [...pending];
    pending.clear();
    if (paths.length === 0) return;
    void run('indexing', () => indexVaultPaths(paths));
    scheduleCommit();
  };

  const onEvent = (_event: string, filename: string | Buffer | null) => {
    if (stopped) return;
    if (filename === null) {
      void run('rescan', rescanVault);
      return;
    }
    const relative = String(filename).split('\\').join('/');
    if (isIgnoredPath(relative)) return;
    pending.add(relative);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, options.debounceMs);
  };

  const extract = async () => {
    if (extracting || stopped) return;
    extracting = true;
    try {
      while (!stopped && (await extractPending(3)) > 0) {
        // Keep going while the queue has entries.
      }
    } catch (error) {
      console.error('[vault] extraction failed:', error);
    } finally {
      extracting = false;
    }
  };

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(root, { recursive: true }, onEvent);
    watcher.on('error', (error) => console.error('[vault] watch failed:', error));
  } catch (error) {
    console.error('[vault] watching the vault failed, relying on the rescan:', error);
  }

  void run('rescan', async () => {
    const { changed } = await rescanVault();
    if (changed > 0) console.log(`[vault] indexed ${changed} changed paths`);
    await commitExternalChanges();
  });
  const rescanTimer = setInterval(() => {
    void run('rescan', async () => {
      await rescanVault();
      await requeueInstalledExtractions();
      scheduleCommit();
    });
  }, options.rescanIntervalMs);
  const extractionTimer = setInterval(() => void extract(), options.extractionIntervalMs);

  return {
    stop() {
      stopped = true;
      watcher?.close();
      clearInterval(rescanTimer);
      clearInterval(extractionTimer);
      if (flushTimer) clearTimeout(flushTimer);
      if (commitTimer) clearTimeout(commitTimer);
    },
    async settled() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flush();
      }
      await chain;
    },
  };
}
