import { withProjectTriageClaim } from '../../claim';
import { db, project } from '@repo/db';
import { eq, sql } from 'drizzle-orm';

const url = new URL(process.env.DATABASE_URL!);
if (
  process.env.NODE_ENV !== 'test' ||
  !url.pathname.includes('test') ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
)
  throw new Error('Private test DB required');
const projectId = Number(process.argv[2]);
const mode = process.argv[3];
let workStarted = false;
try {
  await withProjectTriageClaim(projectId, async () => {
    workStarted = true;
    if (mode === 'hold') {
      console.log('HELD');
      await Bun.stdin.text();
    }
    if (mode === 'write-catch') {
      await db
        .update(project)
        .set({ name: 'Backend completed after client loss' })
        .where(eq(project.id, projectId))
        .catch(() => {});
    }
    if (mode === 'late-transaction') {
      await db.transaction(async (tx) => {
        const rows = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
        console.log(JSON.stringify({ backend: Number(rows[0]!.pid) }));
        await Bun.stdin.text();
        await db
          .update(project)
          .set({ name: 'Late callback completed' })
          .where(eq(project.id, projectId));
      });
    }
  });
  console.log(JSON.stringify({ succeeded: true, workStarted }));
  process.exit(0);
} catch {
  console.log(JSON.stringify({ succeeded: false, workStarted }));
  process.exit(1);
}
