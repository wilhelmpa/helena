import {
  consoleLogger,
  runtimeLoginNeedsOwner,
  type RuntimeLogin,
  type RuntimeLoginReport,
} from '@helena/sdk';
import { registries } from '#shared/helena';

// Whether the model logins Helena's agents share are usable, for the health overview: every
// runtime login source (@helena/sdk runtime-logins.ts; the token keeper's status first) is
// asked, and a report older than a few of its reporter's intervals counts as stale, since
// then nothing renews the logins any more. Decision: docs/helena-decisions/token-keeper.md.

// A reporter that has not written for this many of its intervals has stopped.
const STALE_INTERVALS = 3;
const DEFAULT_INTERVAL_SECONDS = 600;
const POLL_TIMEOUT_MS = 5_000;

export interface RuntimeLoginReportView extends RuntimeLoginReport {
  stale: boolean;
}

export interface RuntimeLoginsHealth {
  reports: RuntimeLoginReportView[];
  // The logins someone has to act on, from reports that are not stale.
  problems: number;
}

function stale(report: RuntimeLoginReport, now: number): boolean {
  const interval = (report.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS) * 1000;
  return now - Date.parse(report.checkedAt) > STALE_INTERVALS * interval;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export async function runtimeLogins(now = new Date()): Promise<RuntimeLoginsHealth> {
  const reports: RuntimeLoginReportView[] = [];
  for (const entry of registries.runtimeLoginSources.entriesList()) {
    try {
      const found = await withTimeout(
        entry.value.poll({ now, log: consoleLogger(`logins ${entry.id}`) }),
        POLL_TIMEOUT_MS,
      );
      for (const report of found) reports.push({ ...report, stale: stale(report, now.getTime()) });
    } catch (error) {
      console.error(`[runtime-logins] ${entry.id} failed:`, error);
    }
  }
  reports.sort((a, b) => a.source.localeCompare(b.source) || a.reporter.localeCompare(b.reporter));
  const problems = reports
    .filter((report) => !report.stale)
    .flatMap((report) => report.logins)
    .filter((login: RuntimeLogin) => runtimeLoginNeedsOwner(login)).length;
  return { reports, problems };
}
