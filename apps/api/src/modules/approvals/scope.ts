import { db, issue, project } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { classifyShell, type ActionCategory, type ActionScope } from '@helena/policy';
import { projectRoot } from '#modules/project-files/roots';

// Card metadata only. Execution still goes through the calling tool's own policy
// adapter; a scope stated in a request never grants permission to execute an action.
export async function approvalScope(input: {
  projectId: number;
  category: ActionCategory;
  action: string;
  command: string | null;
  scope?: ActionScope;
}): Promise<ActionScope> {
  if (input.scope === 'external') return 'external';
  if (input.command) {
    const [row] = await db
      .select({ key: project.key })
      .from(project)
      .where(eq(project.id, input.projectId));
    return classifyShell(input.command, {
      workspace: row ? projectRoot(row.key, 'code').directory : null,
    }).scope;
  }
  if (input.scope) return input.scope;
  if (input.category === 'delete' && (await namesInternalIssue(input.projectId, input.action)))
    return 'workspace';
  return input.category === 'write' ? 'workspace' : 'external';
}

// Older callers describe a ticket deletion in words. Recognize only a concrete
// deletion of an existing ticket here, never an external action that merely mentions
// a ticket key (such as "Delete the Drive folder for MKT-1"). Ambiguous requests can
// state scope explicitly instead of guessing from arbitrary prose.
async function namesInternalIssue(projectId: number, action: string): Promise<boolean> {
  const key =
    /^(?:delete|remove|lösche|löschen|entferne|entfernen)\s+(?:(?:ticket|issue)\s+)?([A-Z][A-Z0-9]*-\d+)(?:\s+(?:for good|permanently|endgültig|dauerhaft))?[.!]?$/i.exec(
      action,
    )?.[1] ??
    /^(?:(?:ticket|issue)\s+)?([A-Z][A-Z0-9]*-\d+)\s+(?:(?:endgültig|dauerhaft)\s+)?(?:löschen|entfernen)[.!]?$/i.exec(
      action,
    )?.[1];
  const toolId = /^delete_issue\s+\{\s*"issueId"\s*:\s*(\d+)\s*\}$/i.exec(action)?.[1];
  if (!key && !toolId) return false;
  const [row] = await db
    .select({ id: issue.id })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .where(
      and(
        eq(issue.projectId, projectId),
        toolId
          ? eq(issue.id, Number(toolId))
          : and(
              eq(project.key, key!.slice(0, key!.lastIndexOf('-')).toUpperCase()),
              eq(issue.sequenceNumber, Number(key!.slice(key!.lastIndexOf('-') + 1))),
            ),
      ),
    );
  return Boolean(row);
}
