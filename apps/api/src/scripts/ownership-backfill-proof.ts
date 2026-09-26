/** Root operator only: dry-run by default; never imported by the application. */
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, issue, issueActivity, project, user } from '@repo/db';
import { canBeIssueAssignee, resolveIssueAssignee } from '#modules/issues/responsibility';

const manifest = [
  { id: 63, sequence: 12 },
  { id: 64, sequence: 13 },
] as const;
const flags = process.argv.slice(2);
const apply = flags.includes('--apply');
const value = (name: string) =>
  flags.find((flag) => flag.startsWith(`--${name}=`))?.slice(name.length + 3);
const expectedHead = value('expected-head');
let stage = 'preflight';
try {
  if (
    flags.some(
      (flag) =>
        !['--apply', '--dry-run'].includes(flag) &&
        !/^--(expected-head|project-id|team-id|owner-id)=/.test(flag),
    )
  )
    throw new Error('Unknown argument');
  if (flags.includes('--dry-run') && apply) throw new Error('Choose one mode');
  const database = new URL(process.env.DATABASE_URL ?? '');
  const privateTest =
    process.env.NODE_ENV === 'test' &&
    ['localhost', '127.0.0.1'].includes(database.hostname) &&
    database.port !== '' &&
    database.port !== '5432' &&
    /_test$/.test(database.pathname);
  if (!privateTest && userInfo().username !== 'volition-plan')
    throw new Error('Run through the root-owned systemd unit as volition-plan');
  const liveRoot = '/srv/volition/source/plan';
  if (!privateTest && process.cwd() !== liveRoot)
    throw new Error('Run in the reviewed live checkout');
  // This checkout belongs to the deploy user, not the service account. Trust only
  // this exact operator-reviewed path for these read-only Git calls; no global config.
  const git = (args: string[]) =>
    execFileSync('git', ['-c', `safe.directory=${liveRoot}`, '-C', liveRoot, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  const head = privateTest ? '0'.repeat(40) : git(['rev-parse', 'HEAD']);
  if (apply && (!expectedHead || !/^[a-f0-9]{40}$/.test(expectedHead) || expectedHead !== head))
    throw new Error('Expected deployed revision is required');
  if (!privateTest) git(['merge-base', '--is-ancestor', 'c2d23311', head]);
  stage = 'locked-backfill';
  const result = await db.transaction(async (tx) => {
    if (!apply) await tx.execute(sql`SET TRANSACTION READ ONLY`);
    // Same lock order as create/updateIssue: project first, then the manifest issue rows.
    const projects = tx
      .select({ id: project.id, teamId: project.teamId })
      .from(project)
      .where(eq(project.key, 'PRIV'));
    const [targetProject] = apply ? await projects.for('update') : await projects;
    if (!targetProject) throw new Error('Expected project is absent');
    if (
      apply &&
      (Number(value('project-id')) !== targetProject.id ||
        Number(value('team-id')) !== targetProject.teamId)
    )
      throw new Error('Project and team must match the reviewed dry-run');
    const ownerId = await resolveIssueAssignee(targetProject.id, {}, tx);
    const [owner] = await tx
      .select({ id: user.id, name: user.name, active: user.active })
      .from(user)
      .where(eq(user.id, ownerId));
    if (!owner || owner.active === false) throw new Error('No active responsible owner');
    if (apply && value('owner-id') !== owner.id)
      throw new Error('Responsible owner must match the reviewed dry-run');
    const items = [];
    for (const entry of manifest) {
      const target = tx
        .select({
          id: issue.id,
          assignee: issue.assigneeUserId,
          delegate: issue.delegateUserId,
          columnId: issue.columnId,
          archivedAt: issue.archivedAt,
        })
        .from(issue)
        .where(
          and(
            eq(issue.id, entry.id),
            eq(issue.projectId, targetProject.id),
            eq(issue.sequenceNumber, entry.sequence),
          ),
        );
      const [before] = apply ? await target.for('update') : await target;
      if (!before) throw new Error('Exact manifest target is absent');
      if (before.assignee !== null) {
        if (!(await canBeIssueAssignee(targetProject.id, before.assignee, tx)))
          throw new Error('Existing assignee is invalid; this script only backfills NULL');
        items.push({
          ...entry,
          changed: 0,
          wouldChange: false,
          alreadyAssigned: true,
          assignedToDefaultOwner: before.assignee === ownerId,
        });
        continue;
      }
      if (!apply) {
        items.push({
          ...entry,
          changed: 0,
          wouldChange: true,
          alreadyAssigned: false,
          assignedToDefaultOwner: false,
        });
        continue;
      }
      const changed = await tx
        .update(issue)
        .set({ assigneeUserId: ownerId, updatedAt: new Date() })
        .where(
          and(
            eq(issue.id, entry.id),
            eq(issue.projectId, targetProject.id),
            eq(issue.sequenceNumber, entry.sequence),
            isNull(issue.assigneeUserId),
          ),
        )
        .returning({
          id: issue.id,
          delegate: issue.delegateUserId,
          columnId: issue.columnId,
          archivedAt: issue.archivedAt,
        });
      if (
        changed.length !== 1 ||
        changed[0].delegate !== before.delegate ||
        changed[0].columnId !== before.columnId ||
        changed[0].archivedAt?.getTime() !== before.archivedAt?.getTime()
      )
        throw new Error('Backfill invariant failed');
      // An audit comment in the same transaction, without notification or webhook fan-out.
      await tx.insert(issueActivity).values({
        issueId: entry.id,
        kind: 'comment',
        actorUserId: owner.id,
        actorName: owner.name,
        body: 'Owner backlog 2b: fehlende menschliche Verantwortung auf den zuständigen Owner gesetzt. Status, Archivierung und Agentdelegation unverändert. Idempotenter Root-Backfill.',
      });
      items.push({
        ...entry,
        changed: 1,
        wouldChange: false,
        alreadyAssigned: false,
        assignedToDefaultOwner: true,
      });
    }
    return {
      projectId: targetProject.id,
      teamId: targetProject.teamId,
      responsibleUserId: owner.id,
      changed: items.reduce((sum, item) => sum + item.changed, 0),
      items,
    };
  });
  console.log(
    JSON.stringify({ mode: apply ? 'apply' : 'dry-run', projectKey: 'PRIV', head, ...result }),
  );
  process.exit(0);
} catch (error) {
  // Database errors may contain rows, SQL parameters or connection details.
  console.error(
    JSON.stringify({
      stage,
      errorType: error instanceof Error ? error.name : 'unknown',
      success: false,
    }),
  );
  process.exit(1);
}
