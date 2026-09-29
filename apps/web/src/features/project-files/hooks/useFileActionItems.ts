'use client';

import { useContext } from 'react';
import { FileOverlayCtx } from './fileOverlayContext';
import {
  ClipboardCopy,
  Code2,
  Download,
  FolderInput,
  Link2,
  MessageSquarePlus,
  Pencil,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { FileItem } from '@/lib/api/endpoints/projectFiles';
import { ShellCtx } from '@/context/shellContext';
import { queueChatAttachment } from '@/utils/chatAttachQueue';
import type { FilePermissions } from '../components/FileBrowser';
import type { FileActions } from './useFileActions';

// Everything that can be done with one entry, as data: the row's menu and the buttons of a
// file's overlay draw the same list (owner 29.09., O80: no nameless "…" in the overlay —
// the actions stand there with their names), so a new action is added once.
export type FileActionId =
  | 'download'
  | 'openInCode'
  | 'linkToTask'
  | 'copyLink'
  | 'attachToChat'
  | 'rename'
  | 'move'
  | 'trash';

export interface FileActionItem {
  id: FileActionId;
  label: string;
  Icon: LucideIcon;
  run?: () => void;
  href?: string;
  external?: boolean;
  download?: string;
  destructive?: boolean;
  // Use (download, link …), change (rename, move) or remove (trash): the menu separates them.
  group: 'use' | 'change' | 'remove';
  // Shown as its own button in the overlay; the others go under "More actions".
  main: boolean;
}

export function useFileActionItems({
  item,
  actions,
  can,
  onRename,
  withDialogs = true,
}: {
  item: FileItem;
  actions: FileActions;
  can: FilePermissions;
  // Renames in place (a row of Wissen) instead of the rename dialog.
  onRename?: () => void;
  // Off where the page has no dialogs to ask (a pinned overlay on another page).
  withDialogs?: boolean;
}): FileActionItem[] {
  const t = useTranslations('files.actions');
  const shell = useContext(ShellCtx);
  const overlay = useContext(FileOverlayCtx);
  const file = item.kind === 'file';
  const code = actions.codeUrl(item);
  const canonical = actions.vaultPath(item);
  const items: FileActionItem[] = [];
  if (file)
    items.push({
      id: 'download',
      label: t('download'),
      Icon: Download,
      href: actions.downloadUrl(item),
      download: item.name,
      group: 'use',
      main: true,
    });
  if (code)
    items.push({
      id: 'openInCode',
      label: t('openInCode'),
      Icon: Code2,
      href: code,
      external: true,
      group: 'use',
      main: false,
    });
  if (file && actions.projectKey && withDialogs)
    items.push({
      id: 'linkToTask',
      label: t('linkToTask'),
      Icon: Link2,
      run: () => actions.ask('link', item),
      group: 'use',
      main: false,
    });
  items.push({
    id: 'copyLink',
    label: t('copyLink'),
    Icon: ClipboardCopy,
    run: () => void actions.copyPath(item),
    group: 'use',
    main: true,
  });
  const openTool = shell?.onOpenWorkspaceTool;
  if (file && canonical && openTool)
    items.push({
      id: 'attachToChat',
      label: t('attachToChat'),
      Icon: MessageSquarePlus,
      run: () => {
        queueChatAttachment({ path: canonical, name: item.name });
        // The chat opens over the page; the file's overlay would cover it.
        overlay?.dismiss();
        openTool('chat');
      },
      group: 'use',
      main: true,
    });
  if (can.edit && withDialogs) {
    items.push({
      id: 'rename',
      label: t('rename'),
      Icon: Pencil,
      run: () => (onRename ? onRename() : actions.ask('rename', item)),
      group: 'change',
      main: true,
    });
    items.push({
      id: 'move',
      label: t('move'),
      Icon: FolderInput,
      run: () => actions.ask('move', item),
      group: 'change',
      main: true,
    });
  }
  if (can.delete && withDialogs)
    items.push({
      id: 'trash',
      label: t('trash'),
      Icon: Trash2,
      run: () => actions.ask('trash', item),
      destructive: true,
      group: 'remove',
      main: true,
    });
  return items;
}
