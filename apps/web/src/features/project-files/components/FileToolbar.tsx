import { useRef, type ReactNode } from 'react';
import { Code2, FilePlus, FolderPlus, LayoutGrid, List, NotebookPen, Upload } from 'lucide-react';
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

// The file browser's controls, in the header row like every page's (PageToolbar): the
// page's own tabs first (`leading`, e.g. Wissen/Code), then the name filter, the order,
// list or grid, the code-server link and what can be added to the open folder.
export default function FileToolbar({
  leading,
  view,
  canCreate,
  codeUrl,
  notesUrl,
  uploading,
  onUpload,
  onNewFolder,
  onNewFile,
}: {
  leading?: ReactNode;
  view: ReturnType<typeof useFileBrowserView>;
  canCreate: boolean;
  codeUrl: string;
  notesUrl: string;
  uploading: boolean;
  onUpload: (files: File[]) => void;
  onNewFolder: () => void;
  onNewFile: () => void;
}) {
  const t = useTranslations('files.toolbar');
  const tActions = useTranslations('files.actions');
  const input = useRef<HTMLInputElement>(null);
  const grid = view.mode === 'grid';

  const actions: PageAction[] = [
    {
      id: 'mode',
      label: grid ? t('list') : t('grid'),
      icon: grid ? List : LayoutGrid,
      onClick: () => view.setMode(grid ? 'list' : 'grid'),
    },
  ];
  if (notesUrl) {
    actions.push({
      id: 'notes',
      label: tActions('openInNotes'),
      icon: NotebookPen,
      href: notesUrl,
      external: true,
    });
  }
  if (codeUrl) {
    actions.push({
      id: 'code',
      label: t('openInCode'),
      icon: Code2,
      href: codeUrl,
      external: true,
    });
  }
  if (canCreate) {
    actions.push(
      { id: 'folder', label: t('newFolder'), icon: FolderPlus, onClick: onNewFolder },
      { id: 'note', label: t('newFile'), icon: FilePlus, onClick: onNewFile },
    );
  }

  return (
    <PageToolbar>
      {leading}
      <PageToolbarSpacer />
      <PageSearch value={view.filter} onChange={view.setFilter} placeholder={t('filter')} />
      <FileSortMenu sort={view.sort} onChange={view.setSort} />
      <PageActions
        actions={actions}
        primary={
          canCreate
            ? {
                id: 'upload',
                label: t('upload'),
                icon: Upload,
                disabled: uploading,
                onClick: () => input.current?.click(),
              }
            : undefined
        }
      />
      {canCreate && (
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            onUpload(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      )}
    </PageToolbar>
  );
}
