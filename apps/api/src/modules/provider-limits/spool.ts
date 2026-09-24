import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageLimitSnapshot, UsageLimitSource } from '@helena/sdk';

// The spool: snapshot files a tool on the host drops for Helena to read, numbers only. The
// owner reporter (`itsaplan-runner limits-report`, run as the owner by a systemd timer,
// deployment/volition-stack/native/limits) writes the plan limits of the owner's own
// Claude Code and Codex logins there, which Helena has no other way to reach: the API never
// reads the owner's home. Off unless HELENA_LIMITS_SPOOL_DIR names the directory.
//
// A file: `{ "version": 1, "reporter": "owner", "reportedAt": "…", "snapshots": [ … ] }`,
// each snapshot in the @helena/sdk shape; the store checks every field again.

export const SPOOL_SOURCE_ID = 'spool';
const MAX_FILES = 20;
const MAX_BYTES = 256 * 1024;

export function spoolLimitSource(
  dir: () => string | undefined = () => process.env.HELENA_LIMITS_SPOOL_DIR?.trim() || undefined,
): UsageLimitSource {
  // A file is read again only when it changed.
  const seen = new Map<string, number>();
  return {
    id: SPOOL_SOURCE_ID,
    label: { i18n: 'providerLimits.sources.spool' },
    providers: [],
    async poll(context) {
      const root = dir();
      if (!root) return [];
      let names: string[];
      try {
        names = (await readdir(root)).filter((name) => name.endsWith('.json')).slice(0, MAX_FILES);
      } catch {
        return [];
      }
      const found: UsageLimitSnapshot[] = [];
      for (const name of names) {
        const path = join(root, name);
        try {
          const info = await stat(path);
          if (!info.isFile() || info.size > MAX_BYTES) continue;
          if (seen.get(path) === info.mtimeMs) continue;
          seen.set(path, info.mtimeMs);
          const file = JSON.parse(await readFile(path, 'utf8')) as {
            version?: unknown;
            snapshots?: unknown;
          };
          if (file.version !== 1 || !Array.isArray(file.snapshots)) continue;
          found.push(...(file.snapshots as UsageLimitSnapshot[]));
        } catch (error) {
          context.log.warn(
            `could not read ${name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return found;
    },
  };
}
