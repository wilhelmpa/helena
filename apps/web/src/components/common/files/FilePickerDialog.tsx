import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import type { FileItem, FileScope } from '@/lib/api/endpoints/projectFiles';
import { useFilesQuery } from '@/services/files.service';
import { parentPath } from '@/utils/vaultLinks';
import { cn } from '@/lib/utils';
import FileKindIcon from './FileKindIcon';

// Browses one scope to pick a file, or a folder (the open one). `disabledPath` is a
// folder that cannot be chosen or entered, such as the folder being moved.
export default function FilePickerDialog({
  scope,
  mode,
  title,
  description,
  confirmLabel,
  initialPath = '',
  disabledPath,
  accept,
  onPick,
  onClose,
}: {
  scope: FileScope;
  mode: 'file' | 'folder';
  title: string;
  description?: string;
  confirmLabel: string;
  initialPath?: string;
  disabledPath?: string;
  accept?: (item: FileItem) => boolean;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('files');
  const [path, setPath] = useState(initialPath);
  const [selected, setSelected] = useState<string | null>(null);
  const listing = useFilesQuery(scope, path);
  const items = (listing.data?.items ?? []).filter(
    (item) => item.kind === 'folder' || (mode === 'file' && (!accept || accept(item))),
  );
  const choice = mode === 'folder' ? path : selected;

  return (
    <Modal title={title} description={description} onClose={onClose} wide>
      <div className="flex items-center gap-2 pb-2 text-sm">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('picker.up')}
          disabled={!path}
          onClick={() => {
            setPath(parentPath(path));
            setSelected(null);
          }}
        >
          <ChevronLeft />
        </Button>
        <span className="truncate text-muted-foreground" dir="auto">
          /{path}
        </span>
      </div>
      <ul className="min-h-40 divide-y overflow-y-auto rounded-md border">
        {items.length === 0 && (
          <li className="p-4 text-center text-sm text-muted-foreground">
            {listing.isPending ? t('viewer.loading') : t('picker.empty')}
          </li>
        )}
        {items.map((item) => {
          const disabled = item.path === disabledPath;
          return (
            <li key={item.path}>
              <button
                type="button"
                disabled={disabled}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-accent disabled:opacity-50',
                  selected === item.path && 'bg-accent',
                )}
                onClick={() => {
                  if (item.kind === 'folder') {
                    setPath(item.path);
                    setSelected(null);
                  } else setSelected(item.path);
                }}
              >
                <FileKindIcon
                  name={item.name}
                  contentType={item.contentType}
                  folder={item.kind === 'folder'}
                  className="size-4 shrink-0"
                />
                <span className="truncate" dir="auto">
                  {item.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-2 pt-3">
        <Button variant="outline" onClick={onClose}>
          {t('dialog.cancel')}
        </Button>
        <Button disabled={choice === null} onClick={() => choice !== null && onPick(choice)}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
