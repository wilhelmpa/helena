import { sql } from 'drizzle-orm';
import { db } from './client';
import { janitorRun } from './schema/app';

// Records one run of an api janitor loop, for the health overview. `cleaned` is how
// many rows it cleaned up; null leaves the count of the last run that had one, which is
// what a run that failed before counting anything should do. `error` is null for a run
// that finished, whatever it cleaned.
export async function recordJanitorRun(
  job: string,
  cleaned: number | null,
  error: string | null,
): Promise<void> {
  await db
    .insert(janitorRun)
    .values({ job, ranAt: sql`now()`, cleaned, error })
    .onConflictDoUpdate({
      target: janitorRun.job,
      set: {
        ranAt: sql`now()`,
        cleaned: sql`coalesce(excluded.cleaned, ${janitorRun.cleaned})`,
        error: sql`excluded.error`,
      },
    });
}

export interface JanitorRunRow {
  job: string;
  ranAt: Date;
  cleaned: number | null;
  error: string | null;
}

// Every janitor's last run, for the health overview to fold in the jobs it expects.
export async function listJanitorRuns(): Promise<JanitorRunRow[]> {
  return db.select().from(janitorRun);
}
