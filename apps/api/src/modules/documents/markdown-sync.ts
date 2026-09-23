import {
  db,
  issue,
  projectDocument,
  projectDocumentIssue,
  projectDocumentRevision,
} from '@repo/db';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import {
  deleteProjectFile,
  readProjectText,
  upsertProjectText,
} from '#modules/project-files/service';

export const DOCUMENT_MARKDOWN_DIRECTORY = 'Docs/Plan';
const MAX_LAZY_RETRIES = 3;

export type DocumentMarkdownSyncState = 'synced' | 'pending' | 'private_not_exported';

export interface DocumentMarkdownSyncStatus {
  state: DocumentMarkdownSyncState;
  path: string;
  documentVersion: number;
  etag: string | null;
  attempts: number;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  errorCode: string | null;
  lastError: string | null;
  retryUrl: string;
}

interface MarkdownDocument {
  id: number;
  projectId: number;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  isPrivate: boolean;
  archivedAt: Date | null;
  version: number;
  updatedAt: Date;
}

interface LinkedWorkItem {
  identifier: string;
  title: string;
  url: string;
}

export function documentMarkdownPath(documentId: number): string {
  return `${DOCUMENT_MARKDOWN_DIRECTORY}/doc-${documentId}.md`;
}

export function shouldExportDocumentMarkdown(document: { isPrivate: boolean }): boolean {
  return !document.isPrivate;
}

function appOrigin(): string {
  const configured = process.env.APP_URL?.split(',')[0]?.trim() || 'http://localhost:3001';
  return configured.replace(/\/+$/, '');
}

function planDocumentUrl(projectKey: string, documentId: number): string {
  return `${appOrigin()}/project/${encodeURIComponent(projectKey)}/docs/${documentId}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function renderPortableDocumentMarkdown(input: {
  projectKey: string;
  document: Pick<
    MarkdownDocument,
    'id' | 'title' | 'content' | 'isPrivate' | 'archivedAt' | 'version' | 'updatedAt'
  >;
  linkedWorkItems: LinkedWorkItem[];
}): string {
  if (input.document.isPrivate) {
    throw new Error('Private documents must never be rendered into the shared project folder');
  }
  const workItems = input.linkedWorkItems
    .map(
      (item) =>
        `  - identifier: ${yamlString(item.identifier)}\n` +
        `    title: ${yamlString(item.title)}\n` +
        `    url: ${yamlString(item.url)}`,
    )
    .join('\n');
  const title = input.document.title.trim() || 'Untitled';
  const body = input.document.content.trimEnd();
  const links = input.linkedWorkItems
    .map((item) => `- [${item.identifier}](${item.url}) — ${item.title}`)
    .join('\n');

  return [
    '---',
    'schema: "volition.plan.document/v1"',
    `plan_document_id: ${input.document.id}`,
    `project_key: ${yamlString(input.projectKey)}`,
    `document_version: ${input.document.version}`,
    `title: ${yamlString(title)}`,
    `plan_url: ${yamlString(planDocumentUrl(input.projectKey, input.document.id))}`,
    `archived: ${input.document.archivedAt !== null ? 'true' : 'false'}`,
    `updated_at: ${yamlString(input.document.updatedAt.toISOString())}`,
    ...(workItems ? ['linked_work_items:', workItems] : ['linked_work_items: []']),
    '---',
    '',
    `# ${title}`,
    '',
    body,
    ...(links ? ['', '## Verknüpfte Work Items', '', links] : []),
    '',
  ].join('\n');
}

function previousStatus(document: MarkdownDocument): DocumentMarkdownSyncStatus | null {
  const value = document.metadata.markdownSync;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<DocumentMarkdownSyncStatus>;
  return typeof candidate.state === 'string' && typeof candidate.attempts === 'number'
    ? (candidate as DocumentMarkdownSyncStatus)
    : null;
}

export function shouldLazyRetryDocumentMarkdown(metadata: Record<string, unknown>): boolean {
  const value = metadata.markdownSync;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<DocumentMarkdownSyncStatus>;
  return candidate.state === 'pending' && (candidate.attempts ?? 0) < MAX_LAZY_RETRIES;
}

export function documentMarkdownEtag(metadata: Record<string, unknown>): string | null {
  const value = metadata.markdownSync;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const etag = (value as Partial<DocumentMarkdownSyncStatus>).etag;
  return typeof etag === 'string' && /^"[^"\r\n]+"$/.test(etag) ? etag : null;
}

function retryUrl(projectKey: string, documentId: number): string {
  return `/projects/${encodeURIComponent(projectKey)}/documents/${documentId}/markdown-sync`;
}

export function safeDocumentMarkdownSyncError(error: unknown): { code: string; message: string } {
  if (error instanceof HttpError) {
    if (error.status === 409) {
      return { code: 'etag_conflict', message: 'The generated Markdown changed concurrently.' };
    }
    if (error.status === 413) {
      return { code: 'generated_file_too_large', message: 'The generated Markdown is too large.' };
    }
    if (error.status >= 500) {
      return { code: 'storage_unavailable', message: 'Project file storage is unavailable.' };
    }
    return { code: 'storage_rejected', message: 'Project file storage rejected the sync.' };
  }
  return { code: 'storage_unavailable', message: 'Project file storage is unavailable.' };
}

async function loadDocument(
  projectId: number,
  documentId: number,
): Promise<MarkdownDocument | null> {
  const [document] = await db
    .select({
      id: projectDocument.id,
      projectId: projectDocument.projectId,
      title: projectDocument.title,
      content: projectDocument.content,
      metadata: projectDocument.metadata,
      isPrivate: projectDocument.isPrivate,
      archivedAt: projectDocument.archivedAt,
      version: projectDocument.version,
      updatedAt: projectDocument.updatedAt,
    })
    .from(projectDocument)
    .where(and(eq(projectDocument.id, documentId), eq(projectDocument.projectId, projectId)));
  return document ?? null;
}

async function linkedWorkItems(documentId: number, projectKey: string): Promise<LinkedWorkItem[]> {
  const rows = await db
    .select({
      sequenceNumber: issue.sequenceNumber,
      title: issue.title,
    })
    .from(projectDocumentIssue)
    .innerJoin(issue, eq(issue.id, projectDocumentIssue.issueId))
    .where(eq(projectDocumentIssue.documentId, documentId))
    .orderBy(asc(issue.sequenceNumber));
  return rows.map((row) => ({
    identifier: `${projectKey}-${row.sequenceNumber}`,
    title: row.title,
    url: `${appOrigin()}/project/${encodeURIComponent(projectKey)}/issue/${row.sequenceNumber}`,
  }));
}

async function expectedMarkdown(projectKey: string, document: MarkdownDocument): Promise<string> {
  return renderPortableDocumentMarkdown({
    projectKey,
    document,
    linkedWorkItems: await linkedWorkItems(document.id, projectKey),
  });
}

async function persistStatus(
  document: MarkdownDocument,
  status: DocumentMarkdownSyncStatus,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Sync bookkeeping is operational metadata. It must not manufacture a new
    // user-facing document version or revision.
    await tx.execute(sql`select set_config('app.document_rebalance', 'true', true)`);
    await tx
      .update(projectDocument)
      .set({
        metadata: sql`jsonb_set(${projectDocument.metadata}, '{markdownSync}', ${JSON.stringify(status)}::jsonb, true)`,
      })
      .where(
        and(eq(projectDocument.id, document.id), eq(projectDocument.version, document.version)),
      );
    await tx
      .update(projectDocumentRevision)
      .set({ metadata: sql`${projectDocumentRevision.metadata} - 'markdownSync'` })
      .where(eq(projectDocumentRevision.documentId, document.id));
  });
}

async function persistStatusSafely(
  document: MarkdownDocument,
  status: DocumentMarkdownSyncStatus,
): Promise<void> {
  try {
    await persistStatus(document, status);
  } catch {
    // The document mutation is already committed. Do not make the client retry
    // that mutation and accidentally duplicate work because bookkeeping failed.
    console.error(`[documents] failed to persist Markdown sync status for document ${document.id}`);
  }
}

function successStatus(
  projectKey: string,
  document: MarkdownDocument,
  state: 'synced' | 'private_not_exported',
  etag: string | null,
  at: string,
): DocumentMarkdownSyncStatus {
  return {
    state,
    path: documentMarkdownPath(document.id),
    documentVersion: document.version,
    etag,
    attempts: 0,
    lastAttemptAt: at,
    lastSuccessAt: at,
    errorCode: null,
    lastError: null,
    retryUrl: retryUrl(projectKey, document.id),
  };
}

function pendingStatus(
  projectKey: string,
  document: MarkdownDocument,
  at: string,
  error: { code: string; message: string },
): DocumentMarkdownSyncStatus {
  const previous = previousStatus(document);
  return {
    state: 'pending',
    path: documentMarkdownPath(document.id),
    documentVersion: document.version,
    etag: previous?.etag ?? null,
    attempts: Math.min((previous?.attempts ?? 0) + 1, MAX_LAZY_RETRIES),
    lastAttemptAt: at,
    lastSuccessAt: previous?.lastSuccessAt ?? null,
    errorCode: error.code,
    lastError: error.message,
    retryUrl: retryUrl(projectKey, document.id),
  };
}

/**
 * Synchronize the latest committed row. Reloading here is deliberate: a slow
 * earlier request must never publish stale content after the page became
 * private in a concurrent request.
 */
export async function syncDocumentMarkdown(input: {
  projectId: number;
  projectKey: string;
  documentId: number;
}): Promise<DocumentMarkdownSyncStatus | null> {
  const document = await loadDocument(input.projectId, input.documentId);
  if (!document) return null;
  const at = new Date().toISOString();
  try {
    if (!shouldExportDocumentMarkdown(document)) {
      await deleteProjectFile(
        input.projectKey,
        documentMarkdownPath(document.id),
        documentMarkdownEtag(document.metadata) ?? undefined,
      );
      const status = successStatus(input.projectKey, document, 'private_not_exported', null, at);
      await persistStatusSafely(document, status);
      return status;
    }
    const stored = await upsertProjectText(
      input.projectKey,
      documentMarkdownPath(document.id),
      await expectedMarkdown(input.projectKey, document),
      documentMarkdownEtag(document.metadata),
    );
    const status = successStatus(input.projectKey, document, 'synced', stored.etag, at);
    await persistStatusSafely(document, status);
    return status;
  } catch (error) {
    const status = pendingStatus(
      input.projectKey,
      document,
      at,
      safeDocumentMarkdownSyncError(error),
    );
    await persistStatusSafely(document, status);
    return status;
  }
}

/**
 * Inspect the mirror and perform at most three lazy retry attempts. POSTing the
 * retry route calls syncDocumentMarkdown directly even after the lazy limit.
 */
export async function getDocumentMarkdownSyncStatus(input: {
  projectId: number;
  projectKey: string;
  documentId: number;
}): Promise<DocumentMarkdownSyncStatus | null> {
  const document = await loadDocument(input.projectId, input.documentId);
  if (!document) return null;
  if (!shouldExportDocumentMarkdown(document)) return syncDocumentMarkdown(input);

  const previous = previousStatus(document);
  try {
    const [stored, expected] = await Promise.all([
      readProjectText(input.projectKey, documentMarkdownPath(document.id)),
      expectedMarkdown(input.projectKey, document),
    ]);
    if (stored.content === expected) {
      const at = new Date().toISOString();
      const etag = 'etag' in stored && typeof stored.etag === 'string' ? stored.etag : null;
      const status = successStatus(input.projectKey, document, 'synced', etag, at);
      await persistStatusSafely(document, status);
      return status;
    }
  } catch {
    // A missing or temporarily unreachable mirror follows the same bounded retry path.
  }
  if ((previous?.attempts ?? 0) < MAX_LAZY_RETRIES) return syncDocumentMarkdown(input);
  return previous;
}

export async function removeDocumentMarkdown(
  projectKey: string,
  documentId: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  const value = metadata.markdownSync;
  const status =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<DocumentMarkdownSyncStatus>)
      : null;
  if (
    status &&
    ((status.state === 'pending' && status.etag === null && status.lastSuccessAt === null) ||
      status.state === 'private_not_exported')
  ) {
    return;
  }
  await deleteProjectFile(
    projectKey,
    documentMarkdownPath(documentId),
    documentMarkdownEtag(metadata) ?? undefined,
  );
}

/**
 * Archive and restore mutate an entire page tree. Mirror a bounded tree in the
 * same request so descendants do not retain stale archive/version frontmatter.
 */
export async function syncDocumentMarkdownSubtree(input: {
  projectId: number;
  projectKey: string;
  rootDocumentId: number;
  limit?: number;
}): Promise<DocumentMarkdownSyncStatus | null> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 50);
  const rows = await db
    .select({ id: projectDocument.id, parentId: projectDocument.parentId })
    .from(projectDocument)
    .where(eq(projectDocument.projectId, input.projectId))
    .orderBy(asc(projectDocument.id))
    .limit(500);
  const selected = new Set<number>([input.rootDocumentId]);
  for (let pass = 0; pass < rows.length && selected.size < limit; pass += 1) {
    let changed = false;
    for (const row of rows) {
      if (
        row.parentId !== null &&
        selected.has(row.parentId) &&
        !selected.has(row.id) &&
        selected.size < limit
      ) {
        selected.add(row.id);
        changed = true;
      }
    }
    if (!changed) break;
  }

  let rootStatus: DocumentMarkdownSyncStatus | null = null;
  for (const documentId of selected) {
    const status = await syncDocumentMarkdown({
      projectId: input.projectId,
      projectKey: input.projectKey,
      documentId,
    });
    if (documentId === input.rootDocumentId) rootStatus = status;
  }
  return rootStatus;
}

/** One-shot, bounded bootstrap for pre-existing public documents. */
export async function syncPublicDocumentMarkdownBatch(input: {
  projectId: number;
  projectKey: string;
  limit?: number;
}): Promise<{ selected: number; synced: number; pending: number; privateSkipped: number }> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const rows = await db
    .select({ id: projectDocument.id })
    .from(projectDocument)
    .where(
      and(eq(projectDocument.projectId, input.projectId), eq(projectDocument.isPrivate, false)),
    )
    .orderBy(asc(projectDocument.id))
    .limit(limit);
  const [privateCount] = await db
    .select({ value: count() })
    .from(projectDocument)
    .where(
      and(eq(projectDocument.projectId, input.projectId), eq(projectDocument.isPrivate, true)),
    );

  let synced = 0;
  let pending = 0;
  for (const row of rows) {
    const result = await syncDocumentMarkdown({
      projectId: input.projectId,
      projectKey: input.projectKey,
      documentId: row.id,
    });
    if (result?.state === 'synced') synced += 1;
    else pending += 1;
  }
  return {
    selected: rows.length,
    synced,
    pending,
    privateSkipped: Number(privateCount?.value ?? 0),
  };
}
