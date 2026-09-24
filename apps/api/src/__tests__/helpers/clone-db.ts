import { SQL } from 'bun';

// A test run works on a database of its own: a copy of the migrated test database
// (CREATE DATABASE … TEMPLATE), dropped again when the run ends. Two runs against the same
// server then no longer TRUNCATE each other's rows, which is what made parallel full-test
// runs report failures that were not there.
//
// The copy is named <test db>_run_<epoch ms>_<random>. A copy a crashed run left behind is
// dropped by the next run once it is older than STALE_MS. HELENA_TEST_DB_CLONE=0 keeps the
// old behaviour (every run on the test database itself); so does a server that refuses the
// copy (no CREATEDB right, or a session still connected to the template), with a warning.

const STALE_MS = 6 * 60 * 60 * 1000;
const RUN_INFIX = '_run_';

export interface ClonedDatabase {
  url: string;
  name: string;
  drop: () => Promise<void>;
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function cloneName(template: string, now = Date.now(), random = Math.random()): string {
  const suffix = random.toString(36).slice(2, 8).padEnd(6, '0');
  // Postgres names are at most 63 bytes; the suffix must survive a long template name.
  const tail = `${RUN_INFIX}${now}_${suffix}`;
  return `${template.slice(0, 63 - tail.length)}${tail}`;
}

export function isStaleClone(name: string, template: string, now = Date.now()): boolean {
  const prefix = `${template.slice(0, 63 - (RUN_INFIX.length + 13 + 7))}${RUN_INFIX}`;
  if (!name.startsWith(prefix)) return false;
  const stamp = Number(name.slice(prefix.length).split('_')[0]);
  return Number.isFinite(stamp) && now - stamp > STALE_MS;
}

export async function cloneTestDatabase(url: string): Promise<ClonedDatabase | null> {
  const template = databaseName(url);
  if (!template.includes('test') || template.includes(RUN_INFIX)) return null;
  const admin = new SQL(withDatabase(url, 'postgres'), { max: 1 });
  try {
    const existing = (await admin`SELECT datname FROM pg_database`) as Array<{ datname: string }>;
    for (const { datname } of existing) {
      if (isStaleClone(datname, template)) {
        await admin
          .unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(datname)} WITH (FORCE)`)
          .catch(() => {});
      }
    }
    const name = cloneName(template);
    // Another run may be copying the same template this very moment; Postgres then
    // refuses, so try a few times before falling back.
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await admin.unsafe(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(template)}`);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        await Bun.sleep(250 * (attempt + 1));
      }
    }
    if (lastError) throw lastError;
    return {
      url: withDatabase(url, name),
      name,
      drop: async () => {
        const dropper = new SQL(withDatabase(url, 'postgres'), { max: 1 });
        try {
          await dropper.unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
        } finally {
          await dropper.close();
        }
      },
    };
  } catch (error) {
    console.warn(
      `test database copy failed, running on ${template} itself: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  } finally {
    await admin.close();
  }
}
