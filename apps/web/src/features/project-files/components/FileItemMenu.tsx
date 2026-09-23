import {
  ClipboardCopy,
  Code2,
  Download,
  FolderInput,
  Gem,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FileItem } from '@/lib/api/endpoints/projectFiles';
import type { FileActions } from '../hooks/useFileActions';
import type { FilePermissions } from './FileBrowser';

// Everything that can be done with one entry, behind its "more" button.
export default function FileItemMenu({
  item,
  actions,
  can,
}: {
  item: FileItem;
  actions: FileActions;
  can: FilePermissions;
}) {
  const t = useTranslations('files.actions');
  const file = item.kind === 'file';
  const obsidian = file ? actions.obsidianUrl(item) : '';
  const code = actions.codeUrl(item);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('more', { name: item.name })}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {file && (
          <DropdownMenuItem asChild>
            <a href={actions.downloadUrl(item)} download={item.name}>
              <Download />
              {t('download')}
            </a>
          </DropdownMenuItem>
        )}
        {obsidian && (
          <DropdownMenuItem asChild>
            <a href={obsidian}>
              <Gem />
              {t('openInObsidian')}
            </a>
          </DropdownMenuItem>
        )}
        {code && (
          <DropdownMenuItem asChild>
            <a href={code} target="_blank" rel="noopener noreferrer">
              <Code2 />
              {t('openInCode')}
            </a>
          </DropdownMenuItem>
        )}
        {file && actions.projectKey && (
          <DropdownMenuItem onSelect={() => actions.ask('link', item)}>
            <Link2 />
            {t('linkToTask')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void actions.copyPath(item)}>
          <ClipboardCopy />
          {t('copyPath')}
        </DropdownMenuItem>
        {can.edit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.ask('rename', item)}>
              <Pencil />
              {t('rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.ask('move', item)}>
              <FolderInput />
              {t('move')}
            </DropdownMenuItem>
          </>
        )}
        {can.delete && (
          <DropdownMenuItem variant="destructive" onSelect={() => actions.ask('trash', item)}>
            <Trash2 />
            {t('trash')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
