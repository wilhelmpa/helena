import { Code2, Download, FileText, Link2, NotebookPen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { FileItem } from '@/lib/api/endpoints/projectFiles';
import { fileViewKind } from '@/utils/fileKinds';
import { docsFileUrl } from '@/utils/vaultLinks';
import type { FileActions } from '../hooks/useFileActions';

// The buttons of the viewer on the Files page.
export default function FileViewerActions({
  item,
  actions,
}: {
  item: FileItem;
  actions: FileActions;
}) {
  const t = useTranslations('files.actions');
  const notes = actions.notesUrl(item);
  const code = actions.codeUrl(item);
  const vaultPath = actions.vaultPath(item);
  const docs =
    actions.projectKey && vaultPath && fileViewKind(item.name) === 'markdown'
      ? docsFileUrl(actions.projectKey, vaultPath)
      : '';

  return (
    <>
      <Button size="sm" variant="outline" asChild>
        <a href={actions.downloadUrl(item)} download={item.name}>
          <Download />
          {t('download')}
        </a>
      </Button>
      {docs && (
        <Button size="sm" variant="outline" asChild>
          <Link href={docs}>
            <FileText />
            {t('openInDocs')}
          </Link>
        </Button>
      )}
      {code && (
        <Button size="sm" variant="outline" asChild>
          <a href={code} target="_blank" rel="noopener noreferrer">
            <Code2 />
            {t('openInCode')}
          </a>
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
      {actions.projectKey && (
        <Button size="sm" variant="outline" onClick={() => actions.ask('link', item)}>
          <Link2 />
          {t('linkToTask')}
        </Button>
      )}
    </>
  );
}
