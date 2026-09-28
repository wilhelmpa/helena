import { type ReactNode } from 'react';
import { Code2, LayoutGrid, List } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  PageActions,
  PageSearch,
  PageToolbar,
  PageToolbarSpacer,
  type PageAction,
} from '@/components/layout/PageToolbar';
import type { useFileBrowserView } from '../hooks/useFileBrowserView';
import FileSortMenu from './FileSortMenu';
import FileCreateMenu from './FileCreateMenu';

// The file browser's controls, in the header row like every page's (PageToolbar): the
// page's own tabs first (`leading`, e.g. Wissen/Code), then the name filter, the order,
// list or grid, the code-server link and what can be added to the open folder.
export default function FileToolbar({
  leading,
  view,
  canCreate,
  codeUrl,
  uploading,
  onUpload,
  onNewFolder,
  onNewFile,
  projectKey,
}: {
  leading?: ReactNode;
  view: ReturnType<typeof useFileBrowserView>;
  canCreate: boolean;
  codeUrl: string;
  uploading: boolean;
  onUpload: (files: File[]) => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  projectKey?: string | null;
}) {
  const t = useTranslations('files.toolbar');
  const grid = view.mode === 'grid';

  const actions: PageAction[] = [
    {
      id: 'mode',
      label: grid ? t('list') : t('grid'),
      icon: grid ? List : LayoutGrid,
      onClick: () => view.setMode(grid ? 'list' : 'grid'),
    },
  ];
  if (codeUrl) {
    actions.push({
      id: 'code',
      label: t('openInCode'),
      icon: Code2,
      href: codeUrl,
      external: true,
    });
  }

  return (
    <PageToolbar>
      {leading}
      <PageToolbarSpacer />
      <PageSearch value={view.filter} onChange={view.setFilter} placeholder={t('filter')} />
      <FileSortMenu sort={view.sort} onChange={view.setSort} />
      <PageActions actions={actions} />
      {canCreate && (
        <FileCreateMenu
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onUpload={onUpload}
          projectKey={projectKey}
          uploading={uploading}
        />
      )}
    </PageToolbar>
  );
}
