import { useRef } from 'react';
import { Code2, FilePlus, FolderPlus, LayoutGrid, List, Search, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { useFileBrowserView } from '../hooks/useFileBrowserView';
import FileSortMenu from './FileSortMenu';

// Above the listing: the name filter, the order, list or grid, and what can be added
// to the open folder.
export default function FileToolbar({
  view,
  canCreate,
  codeUrl,
  uploading,
  onUpload,
  onNewFolder,
  onNewFile,
}: {
  view: ReturnType<typeof useFileBrowserView>;
  canCreate: boolean;
  codeUrl: string;
  uploading: boolean;
  onUpload: (files: File[]) => void;
  onNewFolder: () => void;
  onNewFile: () => void;
}) {
  const t = useTranslations('files.toolbar');
  const input = useRef<HTMLInputElement>(null);
  const grid = view.mode === 'grid';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-40 flex-1 sm:max-w-64">
        <Search className="pointer-events-none absolute start-2.5 top-2 size-4 text-muted-foreground" />
        <Input
          value={view.filter}
          onChange={(event) => view.setFilter(event.target.value)}
          placeholder={t('filter')}
          aria-label={t('filter')}
          className="h-8 ps-8"
        />
      </div>
      <FileSortMenu sort={view.sort} onChange={view.setSort} />
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={grid ? t('list') : t('grid')}
        title={grid ? t('list') : t('grid')}
        onClick={() => view.setMode(grid ? 'list' : 'grid')}
      >
        {grid ? <List /> : <LayoutGrid />}
      </Button>
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {codeUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={codeUrl} target="_blank" rel="noopener noreferrer">
              <Code2 />
              {t('openInCode')}
            </a>
          </Button>
        )}
        {canCreate && (
          <>
            <Button variant="outline" size="sm" onClick={onNewFolder}>
              <FolderPlus />
              {t('newFolder')}
            </Button>
            <Button variant="outline" size="sm" onClick={onNewFile}>
              <FilePlus />
              {t('newFile')}
            </Button>
            <Button size="sm" disabled={uploading} onClick={() => input.current?.click()}>
              <Upload />
              {t('upload')}
            </Button>
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
          </>
        )}
      </div>
    </div>
  );
}
