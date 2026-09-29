import type { ReactNode } from 'react';
import {
  ClipboardCopy,
  Code2,
  Download,
  FolderInput,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '@/design-system';
import type { FileItem } from '@/lib/api/endpoints/projectFiles';
import type { FileActions } from '../hooks/useFileActions';
import type { FilePermissions } from './FileBrowser';

// Everything that can be done with one entry, behind its "more" button. `extra` leads the
// menu with what only the caller offers (a doc's source/editor switch).
export default function FileItemMenu({
  item,
  actions,
  can,
  extra,
  size = 'small',
  onRename,
}: {
  item: FileItem;
  actions: FileActions;
  can: FilePermissions;
  extra?: ReactNode;
  size?: 'default' | 'small';
  // Renames in place (a row of Wissen) instead of the rename dialog.
  onRename?: () => void;
}) {
  const t = useTranslations('files.actions');
  const file = item.kind === 'file';
  const code = actions.codeUrl(item);

  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size={size} label={t('more', { name: item.name })}>
          <MoreHorizontal />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end">
        {extra}
        {file && (
          <MenuItem asChild>
            <a href={actions.downloadUrl(item)} download={item.name}>
              <Download />
              {t('download')}
            </a>
          </MenuItem>
        )}
        {code && (
          <MenuItem asChild>
            <a href={code} target="_blank" rel="noopener noreferrer">
              <Code2 />
              {t('openInCode')}
            </a>
          </MenuItem>
        )}
        {file && actions.projectKey && (
          <MenuItem onSelect={() => actions.ask('link', item)}>
            <Link2 />
            {t('linkToTask')}
          </MenuItem>
        )}
        <MenuItem onSelect={() => void actions.copyPath(item)}>
          <ClipboardCopy />
          {t('copyPath')}
        </MenuItem>
        {can.edit && (
          <>
            <MenuSeparator />
            <MenuItem onSelect={() => (onRename ? onRename() : actions.ask('rename', item))}>
              <Pencil />
              {t('rename')}
            </MenuItem>
            <MenuItem onSelect={() => actions.ask('move', item)}>
              <FolderInput />
              {t('move')}
            </MenuItem>
          </>
        )}
        {can.delete && (
          <MenuItem variant="destructive" onSelect={() => actions.ask('trash', item)}>
            <Trash2 />
            {t('trash')}
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}
