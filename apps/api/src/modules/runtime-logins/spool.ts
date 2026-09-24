import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeRuntimeLoginReport, type RuntimeLoginSource } from '@helena/sdk';

// The token keeper's status (docs/helena-decisions/token-keeper.md): the keeper, a timer on
// the host, renews the model logins agents share and writes, next to the agents' views of
// them, a status file per store it keeps: providers, states, expiry times, the owner's
// command for a login that must be signed in again. No token. The API reads the folder
// HELENA_LOGIN_STATUS_DIR names (the keeper's installer sets it); off without it.
//
// A file: `{ "version": 1, "reporter": "helena-token-keeper", "checkedAt": "…",
// "intervalSeconds": 600, "logins": [ … ], "errors": [ … ] }`; checked again field by field.

export const LOGIN_STATUS_SOURCE_ID = 'token-keeper';
const MAX_FILES = 20;
const MAX_BYTES = 256 * 1024;

export function loginStatusSource(
  dir: () => string | undefined = () => process.env.HELENA_LOGIN_STATUS_DIR?.trim() || undefined,
): RuntimeLoginSource {
  return {
    id: LOGIN_STATUS_SOURCE_ID,
    label: { i18n: 'god.systemHealth.logins.sources.keeper' },
    async poll(context) {
      const root = dir();
      if (!root) return [];
      let names: string[];
      try {
        names = (await readdir(root))
          .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
          .sort()
          .slice(0, MAX_FILES);
      } catch (error) {
        context.log.warn(
          `cannot read ${root}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      }
      const reports = [];
      for (const name of names) {
        const path = join(root, name);
        try {
          const info = await stat(path);
          if (!info.isFile() || info.size > MAX_BYTES) continue;
          const file = JSON.parse(await readFile(path, 'utf8')) as { version?: unknown };
          if (file.version !== 1) continue;
          const report = normalizeRuntimeLoginReport(file, LOGIN_STATUS_SOURCE_ID);
          if (report) reports.push(report);
        } catch (error) {
          context.log.warn(
            `could not read ${name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return reports;
    },
  };
}
