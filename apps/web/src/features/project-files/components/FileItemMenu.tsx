import { Fragment, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
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
import { useFileActionItems, type FileActionItem } from '../hooks/useFileActionItems';
import type { FileActions } from '../hooks/useFileActions';
import type { FilePermissions } from './FileBrowser';

function MenuEntry({ action }: { action: FileActionItem }) {
  const { Icon } = action;
  if (action.href)
    return (
      <MenuItem asChild>
        <a
          href={action.href}
          download={action.download}
          {...(action.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          <Icon />
          {action.label}
        </a>
      </MenuItem>
    );
  return (
    <MenuItem variant={action.destructive ? 'destructive' : undefined} onSelect={action.run}>
      <Icon />
      {action.label}
    </MenuItem>
  );
}

// Everything that can be done with one row, behind its "more" button. `extra` leads the
// menu with what only the caller offers (a doc's source/editor switch). The overlay of a
// file shows the same actions as named buttons (FileActionBar).
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
  const items = useFileActionItems({ item, actions, can, onRename });
  const groups = (['use', 'change', 'remove'] as const)
    .map((group) => items.filter((action) => action.group === group))
    .filter((group) => group.length > 0);

  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size={size} label={t('more', { name: item.name })}>
          <MoreHorizontal />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end">
        {extra}
        {groups.map((group, index) => (
          <Fragment key={group[0]!.group}>
            {index > 0 && <MenuSeparator />}
            {group.map((action) => (
              <MenuEntry key={action.id} action={action} />
            ))}
          </Fragment>
        ))}
      </MenuContent>
    </Menu>
  );
}
