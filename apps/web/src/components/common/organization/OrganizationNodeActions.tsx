'use client';

import { LibraryBig, Plus, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/design-system';

// The "+" at a node of the Team chart (Auftrag 117): at a coordinator, a department or a
// project, "Mitglied hinzufügen" opens the member dialog set to that place; at an agent,
// "Als Vorlage in den Pool" extends the pool from it. One action is a button, two a menu.
// It sits over the chart, so it never passes a click or a drag to the node or the pane.
export default function OrganizationNodeActions({
  name,
  onAdd,
  onSaveTemplate,
  placement = 'bottom',
}: {
  name: string;
  onAdd?: () => void;
  onSaveTemplate?: () => void;
  // Under a card of the tree, or at the corner of a node of the ring.
  placement?: 'bottom' | 'corner';
}) {
  const t = useTranslations('organization.chart');
  const tAgents = useTranslations('teams.agents');
  if (!onAdd && !onSaveTemplate) return null;
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const className = 'ds-org-node-add nodrag nopan';
  if (onAdd && !onSaveTemplate)
    return (
      <button
        type="button"
        className={className}
        data-placement={placement}
        aria-label={t('addHere', { name })}
        title={t('addHere', { name })}
        onPointerDown={stop}
        onDoubleClick={stop}
        onClick={(event) => {
          event.stopPropagation();
          onAdd();
        }}
      >
        <Plus size={14} />
      </button>
    );
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className={className}
          data-placement={placement}
          aria-label={t('nodeMenu', { name })}
          title={t('nodeMenu', { name })}
          onPointerDown={stop}
          onDoubleClick={stop}
          onClick={stop}
        >
          <Plus size={14} />
        </button>
      </MenuTrigger>
      <MenuContent align="center" onClick={stop}>
        {onAdd && (
          <MenuItem onSelect={onAdd}>
            <UserPlus />
            {t('addMemberHere')}
          </MenuItem>
        )}
        {onSaveTemplate && (
          <MenuItem onSelect={onSaveTemplate}>
            <LibraryBig />
            {tAgents('saveAsTemplate')}
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}
