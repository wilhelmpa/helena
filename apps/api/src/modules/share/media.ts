import { HttpError } from '#shared/lib';
import { getAttachmentByPublicId } from '#modules/attachments/service';
import { attachmentFile } from '#modules/attachments/file';
import { ATTACHMENT_INLINE } from '#modules/project-files/serve';
import { getSharedIssue, getSharedViewIssue } from './service';

// A share is a revocable capability for precisely the issues it exposes. A raw
// attachment UUID alone grants nothing, including after a token is revoked.
export async function sharedAttachment(
  kind: 'issue' | 'view',
  token: string,
  publicId: string,
  request: Request,
  download: boolean,
) {
  const row = await getAttachmentByPublicId(publicId);
  if (!row) throw new HttpError(404, 'Not found');
  const bundle =
    kind === 'issue' ? await getSharedIssue(token) : await getSharedViewIssue(token, row.issueId);
  if (!bundle || bundle.issue.id !== row.issueId) throw new HttpError(404, 'Not found');
  return attachmentFile(publicId, request, download, ATTACHMENT_INLINE);
}

// The shared bundle is already redacted. Rewrite its local embeds to the scoped
// media capability, preserving descriptions, fields and comments from old links.
export function rewriteSharedMedia<T>(bundle: T, kind: 'issue' | 'view', token: string): T {
  const pattern =
    /(?:https?:\/\/[^/\s"<>\\]+)?\/(?:media\/|api\/)?attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/raw/gi;
  return JSON.parse(
    JSON.stringify(bundle).replace(pattern, `/media/share/${kind}/${token}/attachments/$1/raw`),
  );
}
