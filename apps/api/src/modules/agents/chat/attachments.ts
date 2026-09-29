import path from 'node:path';
import { db, issue, project } from '@repo/db';
import { eq, inArray } from 'drizzle-orm';
import { checkPermission, requireProjectAccess, type AuthUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { homeRoot, projectRootOf, vaultDirectory } from '#modules/project-files/roots';
import { statVaultFile } from '#modules/project-files/service';
import { relativePath } from '#modules/project-files/paths';
import { canAccess, vaultScope } from '#modules/knowledge/scope';

// What a question carries besides its text: vault files the member attached, and tasks
// the member pointed the agent at. The files stay where they are in the vault; the
// agent reads them from disk, which is why the prompt names them by absolute path.
export type ChatAttachment =
  | { kind: 'file'; path: string; name: string; contentType: string; sizeBytes: number }
  | { kind: 'task'; issueId: number; identifier: string; title: string }
  | { kind: 'page'; projectKey: string | null; path: string };
export type PublicChatAttachment = Exclude<ChatAttachment, { kind: 'page' }>;

export const MAX_ATTACHMENTS = 10;

// Chat attachment selection has the same file access as the workspace. Private/
// is never handed to an agent, even when the sender may read it personally.
async function resolveFile(user: AuthUser, vaultPath: string): Promise<ChatAttachment> {
  relativePath(vaultPath);
  const [top, ...rest] = vaultPath.split('/');
  if (!['Home', 'Templates', 'Projects'].includes(top)) {
    throw new HttpError(400, 'Attach files from Home, Templates or a project');
  }
  if (!canAccess(await vaultScope(user, false), vaultPath, 'read')) {
    throw new HttpError(404, 'File not found');
  }
  let described;
  if (top === 'Home' || top === 'Templates') {
    described = await statVaultFile(
      homeRoot(top === 'Home' ? 'home' : 'templates'),
      rest.join('/'),
    );
  } else {
    const entry = projectRootOf(vaultPath);
    const key = rest[0];
    if (!entry || !key) throw new HttpError(400, 'Attach files from Home, Templates or a project');
    const [row] = await db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.key, key.toUpperCase()));
    if (!row || !(await checkPermission(row.id, user, 'documents', 'read'))) {
      throw new HttpError(404, 'File not found');
    }
    described = await statVaultFile(entry.root, entry.relative);
  }
  return {
    kind: 'file',
    path: described.vaultPath,
    name: described.name,
    contentType: described.contentType,
    sizeBytes: described.sizeBytes,
  };
}

async function resolveTasks(user: AuthUser, issueIds: number[]): Promise<ChatAttachment[]> {
  if (issueIds.length === 0) return [];
  const rows = await db
    .select({
      id: issue.id,
      projectId: issue.projectId,
      sequenceNumber: issue.sequenceNumber,
      title: issue.title,
      key: project.key,
    })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .where(inArray(issue.id, issueIds));
  const tasks: ChatAttachment[] = [];
  for (const id of issueIds) {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row || !(await checkPermission(row.projectId, user, 'work_items', 'read'))) {
      throw new HttpError(404, 'Task not found');
    }
    tasks.push({
      kind: 'task',
      issueId: row.id,
      identifier: `${row.key}-${row.sequenceNumber}`,
      title: row.title,
    });
  }
  return tasks;
}

export async function resolveAttachments(
  user: AuthUser,
  input: { files?: string[]; issueIds?: number[] },
): Promise<ChatAttachment[]> {
  const files = [...new Set(input.files ?? [])];
  const issueIds = [...new Set(input.issueIds ?? [])];
  if (files.length + issueIds.length > MAX_ATTACHMENTS) {
    throw new HttpError(400, `A message takes at most ${MAX_ATTACHMENTS} attachments`);
  }
  const resolved: ChatAttachment[] = [];
  for (const file of files) resolved.push(await resolveFile(user, file));
  return [...resolved, ...(await resolveTasks(user, issueIds))];
}

export async function resolvePageContext(
  user: AuthUser,
  context: { projectKey: string | null; path: string } | undefined,
): Promise<ChatAttachment[]> {
  if (!context) return [];
  const { projectKey, path: pagePath } = context;
  if (!pagePath.startsWith('/') || pagePath.startsWith('//') || /[\\\r\n\0]/.test(pagePath)) {
    throw new HttpError(400, 'Invalid page context');
  }
  if (projectKey) {
    await requireProjectAccess(projectKey, user);
    const projectPath = `/project/${encodeURIComponent(projectKey)}`;
    if (
      pagePath !== projectPath &&
      !pagePath.startsWith(`${projectPath}/`) &&
      !pagePath.startsWith(`${projectPath}?`)
    ) {
      throw new HttpError(400, 'Page context does not match project');
    }
  } else if (pagePath.startsWith('/project/')) {
    throw new HttpError(400, 'Page context needs a project');
  }
  return [{ kind: 'page', projectKey, path: pagePath }];
}

export function absoluteVaultPath(vaultPath: string): string {
  return path.join(vaultDirectory(), vaultPath);
}

// The absolute paths of the images of a question, which the runner hands to the model
// as images rather than as paths it has to open.
export function imagePaths(attachments: ChatAttachment[]): string[] {
  return attachments.flatMap((attachment) =>
    attachment.kind === 'file' && /^image\/(png|jpe?g|gif|webp)$/.test(attachment.contentType)
      ? [absoluteVaultPath(attachment.path)]
      : [],
  );
}

// The question as the agent reads it: the member's text, then the files by the path
// the agent opens them at, then the tasks it looks up with Plan's tools.
export function questionText(
  content: string,
  attachments: ChatAttachment[] | null,
  displayName = 'Helena',
): string {
  if (!attachments || attachments.length === 0) return content;
  const lines = [content];
  const files = attachments.flatMap((attachment) =>
    attachment.kind === 'file' ? [attachment] : [],
  );
  if (files.length > 0) {
    lines.push('', 'Attached files (read them from disk):');
    for (const file of files) {
      lines.push(`- ${absoluteVaultPath(file.path)} (${file.contentType})`);
    }
  }
  const tasks = attachments.flatMap((attachment) =>
    attachment.kind === 'task' ? [attachment] : [],
  );
  if (tasks.length > 0) {
    lines.push('', `Tasks the person refers to (read them with ${displayName}'s tools):`);
    for (const task of tasks) lines.push(`- ${task.identifier} "${task.title}"`);
  }
  const page = attachments.find((attachment) => attachment.kind === 'page');
  if (page && page.kind === 'page') {
    lines.push('', `Current ${displayName} page: ${page.path}`);
    if (page.projectKey) lines.push(`Current project: ${page.projectKey}`);
  }
  return lines.join('\n');
}
