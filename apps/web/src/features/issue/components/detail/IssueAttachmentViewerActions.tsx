import { Download, FolderOpen, NotebookPen } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { Attachment } from '@/lib/api/endpoints/attachments';
import { filesPath } from '@/utils/paths';
import { runtimeEnv } from '@/utils/runtimeEnv';
import {
  notesFileUrl,
  parentPath,
  projectRelativePath,
  vaultProjectKey,
} from '@/utils/vaultLinks';

// The buttons of the viewer for an attachment: save it, and find it in the project's
// Files and in the notes.
export default function IssueAttachmentViewerActions({ attachment }: { attachment: Attachment }) {
  const t = useTranslations('files.actions');
  const vaultPath = attachment.missing ? null : (attachment.vaultPath ?? null);
  const projectKey = vaultPath ? vaultProjectKey(vaultPath) : null;
  const relative = vaultPath ? projectRelativePath(vaultPath) : '';
  const notes = vaultPath ? notesFileUrl(runtimeEnv().workspace.notesUrl, vaultPath) : '';

  return (
    <>
      <Button size="sm" variant="outline" asChild>
        <a href={`${attachment.url}?download=1`} download={attachment.filename}>
          <Download />
          {t('download')}
        </a>
      </Button>
      {projectKey && (
        <Button size="sm" variant="outline" asChild>
          <Link href={filesPath(projectKey, parentPath(relative), { file: relative })}>
            <FolderOpen />
            {t('showInFolder')}
          </Link>
        </Button>
      )}
      {notes && (
        <Button size="sm" variant="outline" asChild>
          <a href={notes} target="_blank" rel="noopener noreferrer">
            <NotebookPen />
            {t('openInNotes')}
          </a>
        </Button>
      )}
    </>
  );
}
