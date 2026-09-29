import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Button,
  ButtonAnchor,
  Inline,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from '@/design-system';
import type { FileItem } from '@/lib/api/endpoints/projectFiles';
import { useFileActionItems, type FileActionItem } from '../hooks/useFileActionItems';
import type { FileActions } from '../hooks/useFileActions';
import type { FilePermissions } from './FileBrowser';

function ActionButton({ action }: { action: FileActionItem }) {
  const icon = <action.Icon size={14} aria-hidden="true" />;
  if (action.href)
    return (
      <ButtonAnchor
        href={action.href}
        download={action.download}
        external={action.external}
        size="small"
        icon={icon}
      >
        {action.label}
      </ButtonAnchor>
    );
  return (
    <Button
      variant={action.destructive ? 'danger' : 'quiet'}
      size="small"
      icon={icon}
      onClick={action.run}
    >
      {action.label}
    </Button>
  );
}

// What can be done with a file, standing in its overlay with names (owner 29.09., O80: the
// nameless "…" of the preview was not understood). The important actions are buttons;
// the rare ones sit under a menu that says what it holds. The same list as the row's menu
// (useFileActionItems).
export default function FileActionBar({
  item,
  actions,
  can,
  withDialogs = true,
}: {
  item: FileItem;
  actions: FileActions;
  can: FilePermissions;
  withDialogs?: boolean;
}) {
  const t = useTranslations('files.actions');
  const items = useFileActionItems({ item, actions, can, withDialogs });
  const main = items.filter((action) => action.main);
  const more = items.filter((action) => !action.main);
  if (items.length === 0) return null;
  return (
    <Inline gap={2} wrap className="ds-file-actions" data-file-actions="">
      {main.map((action) => (
        <ActionButton key={action.id} action={action} />
      ))}
      {more.length > 0 && (
        <Menu>
          <MenuTrigger asChild>
            <Button
              variant="quiet"
              size="small"
              icon={<ChevronDown size={14} aria-hidden="true" />}
            >
              {t('moreActions')}
            </Button>
          </MenuTrigger>
          <MenuContent align="start">
            {more.map((action) => {
              const Icon = action.Icon;
              return action.href ? (
                <MenuItem key={action.id} asChild>
                  <a
                    href={action.href}
                    {...(action.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    <Icon />
                    {action.label}
                  </a>
                </MenuItem>
              ) : (
                <MenuItem key={action.id} onSelect={action.run}>
                  <Icon />
                  {action.label}
                </MenuItem>
              );
            })}
          </MenuContent>
        </Menu>
      )}
    </Inline>
  );
}
