import { stat } from 'node:fs/promises';
import { extractText, missingPrograms } from './extract';
import { absoluteVaultPath } from './paths';
import { hasProgram } from './process';
import {
  pendingExtractions,
  requeueExtractions,
  saveExtraction,
  unavailableExtractions,
} from './store';

const MISSING_PREFIX = 'missing: ';

// Extracts the text of up to `limit` queued entries and returns how many it handled. The
// queue has one consumer, the worker's watcher, so entries are not claimed.
export async function extractPending(limit: number): Promise<number> {
  const rows = await pendingExtractions(limit);
  for (const row of rows) {
    const file = absoluteVaultPath(row.path);
    if (!(await stat(file).catch(() => null))?.isFile()) {
      await saveExtraction(row.id, row.sha256, { text: null, status: 'skipped', error: 'gone' });
      continue;
    }
    let outcome;
    try {
      outcome = await extractText(file);
    } catch (error) {
      outcome = { status: 'failed' as const, error: String(error) };
    }
    switch (outcome.status) {
      case 'done':
        await saveExtraction(row.id, row.sha256, {
          text: outcome.text,
          status: 'done',
          error: null,
        });
        break;
      case 'unavailable':
        await saveExtraction(row.id, row.sha256, {
          text: null,
          status: 'unavailable',
          error: MISSING_PREFIX + outcome.missing.join(', '),
        });
        break;
      case 'failed':
        await saveExtraction(row.id, row.sha256, {
          text: null,
          status: 'failed',
          error: outcome.error.slice(0, 500),
        });
        break;
      case 'skipped':
        await saveExtraction(row.id, row.sha256, {
          text: null,
          status: 'skipped',
          error: outcome.reason,
        });
        break;
    }
  }
  return rows.length;
}

// Puts entries back in the queue whose extraction was unavailable and whose programs
// have been installed since.
export async function requeueInstalledExtractions(): Promise<void> {
  const ready = (await unavailableExtractions()).filter((row) => {
    const missing = row.extractionError?.startsWith(MISSING_PREFIX)
      ? row.extractionError.slice(MISSING_PREFIX.length).split(', ')
      : missingPrograms(row.path);
    return missing.every(hasProgram);
  });
  await requeueExtractions(ready.map((row) => row.id));
}
