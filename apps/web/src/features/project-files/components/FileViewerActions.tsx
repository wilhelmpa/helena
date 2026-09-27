import { Code2, Download, Link2, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { FileItem } from '@/lib/api/endpoints/projectFiles';
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
  const code = actions.codeUrl(item);

  return (
    <>
      <Button size="sm" variant="outline" asChild>
        <a href={actions.downloadUrl(item)} download={item.name}>
          <Download />
          {t('download')}
        </a>
      </Button>
      {code && (
        <Button size="sm" variant="outline" asChild>
          <a href={code} target="_blank" rel="noopener noreferrer">
            <Code2 />
            {t('openInCode')}
          </a>
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => actions.copyPath(item)}>
        <Copy />
        {t('copyPath')}
      </Button>
      {actions.projectKey && (
        <Button size="sm" variant="outline" onClick={() => actions.ask('link', item)}>
          <Link2 />
          {t('linkToTask')}
        </Button>
      )}
    </>
  );
}
