import { db, mailThread } from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { HttpError } from '#shared/lib';

// Agent tools accept the numeric Helena thread ID returned by search_mail and the
// external Gmail thread ID that older triage tasks stored. Resolution is always
// restricted to the tool's project before a message or draft can be read.
export async function resolveProjectThreadId(
  reference: string,
  projectId: number,
): Promise<number> {
  if (/^[1-9]\d*$/.test(reference)) {
    const id = Number(reference);
    // mail_thread.id is a PostgreSQL int4. Numeric provider references can be
    // valid JavaScript integers while overflowing that database column.
    if (Number.isSafeInteger(id) && id <= 2_147_483_647) {
      const [local] = await db
        .select({ id: mailThread.id })
        .from(mailThread)
        .where(and(eq(mailThread.id, id), eq(mailThread.projectId, projectId)));
      if (local) return local.id;
    }
  }
  const [external, duplicate] = await db
    .select({ id: mailThread.id })
    .from(mailThread)
    .where(
      and(
        eq(mailThread.projectId, projectId),
        inArray(mailThread.threadKey, [reference, `thread:${reference}`]),
      ),
    )
    .limit(2);
  if (duplicate)
    throw new HttpError(400, 'Mail thread is ambiguous; use the numeric ID from search_mail');
  if (!external) throw new HttpError(404, 'Mail thread not found');
  return external.id;
}
