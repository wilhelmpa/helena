'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import type { MruEntry } from '../hooks/useNoteBoardMru';
import type { NewBoardVisibility } from '../utils/visibility';
import NoteBoardNameDialog from './NoteBoardNameDialog';
import NoteBoardTabs from './NoteBoardTabs';
import { usePageToolbarNavigation } from '@/context/pageToolbarNavigation';
import BoardSwitcher from './BoardSwitcher';

// The notes header row (PageToolbar, docs/volition/ui-standard.md): the recently used
// boards as tabs (the host's MRU list), the switcher over every board, and "Neues
// Board" as the page's one primary action.
export default function NoteBoardBar({
  projectKey,
  tabs,
  activeBoardId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  projectKey: string;
  tabs: MruEntry[];
  activeBoardId: number | null;
  onSelect: (id: number) => void;
  onCreate: (name: string, visibility: NewBoardVisibility) => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
}) {
  // 'create' to open the new-board dialog, an MRU entry to rename, or null (closed).
  const [dialog, setDialog] = useState<'create' | MruEntry | null>(null);
  const t = useTranslations('notes');
  const navigation = usePageToolbarNavigation();
  const renaming = dialog && typeof dialog === 'object' ? dialog : null;
  const { can } = usePermissions();
  const canCreate = can('note_boards', 'create');

  // A stable remount key for the name dialog so its input resets per open.
  function dialogKey() {
    if (renaming) return `rename-${renaming.id}`;
    return dialog === 'create' ? 'create' : 'closed';
  }

  return (
    <PageToolbar>
      {navigation}
      <NoteBoardTabs
        tabs={tabs}
        activeBoardId={activeBoardId}
        onSelect={onSelect}
        onRename={(tab) => setDialog(tab)}
        onDelete={onDelete}
      />
      <BoardSwitcher projectKey={projectKey} activeBoardId={activeBoardId} onSelect={onSelect} />
      <PageToolbarSpacer />
      <PageActions
        primary={
          canCreate
            ? { id: 'new', label: t('newBoard'), icon: Plus, onClick: () => setDialog('create') }
            : undefined
        }
      />

      <NoteBoardNameDialog
        key={dialogKey()}
        open={dialog != null}
        title={renaming ? t('renameBoard') : t('newBoard')}
        description={renaming ? undefined : t('newBoardDescription')}
        projectKey={projectKey}
        initial={renaming?.name ?? ''}
        withVisibility={dialog === 'create'}
        onClose={() => setDialog(null)}
        onSubmit={(name, visibility) => {
          if (renaming) onRename(renaming.id, name);
          else onCreate(name, visibility);
          setDialog(null);
        }}
      />
    </PageToolbar>
  );
}
