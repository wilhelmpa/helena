import { HttpError } from '#shared/lib';
import { serveVaultFile } from '#modules/project-files/service';
import { getAttachmentByPublicId } from './service';
import { currentAttachmentPath } from './vault';
import { attachmentObjectResponse } from './storage';

// The file of an attachment, served inline for the kinds `inline` allows.
export async function attachmentFile(
  publicId: string,
  request: Request,
  download: boolean,
  inline: (contentType: string) => boolean,
) {
  const row = await getAttachmentByPublicId(publicId);
  if (!row) throw new HttpError(404, 'Attachment not found');
  if (!row.vaultPath && row.s3Key) {
    return attachmentObjectResponse({
      s3Key: row.s3Key,
      contentType: row.contentType,
      filename: row.filename,
      request,
      download,
    });
  }
  const vaultPath = await currentAttachmentPath(row);
  if (!vaultPath) throw new HttpError(404, 'The file of this attachment is missing');
  return serveVaultFile({
    vaultPath,
    filename: row.filename,
    contentType: row.contentType,
    request,
    download,
    inline,
  });
}
