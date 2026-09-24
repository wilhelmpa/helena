'use client';

import { Maximize2, Minimize2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { NoteBoardVisibility } from '@/lib/api/endpoints/noteBoards';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import NoteBoardAccessList from './NoteBoardAccessList';
import NoteBoardAccessPicker from './NoteBoardAccessPicker';
import { VISIBILITY_ICON } from '../utils/visibility';

export default function NoteCanvasControls({
  projectKey,
  canEdit,
  visibility,
  ownerUserId,
  memberIds,
  canChangeVisibility,
  fullscreen,
  onAddNote,
  onChangeVisibility,
  onToggleFullscreen,
}: {
  projectKey: string;
  canEdit: boolean;
  visibility: NoteBoardVisibility;
  ownerUserId: string | null;
  memberIds: string[];
  canChangeVisibility: boolean;
  fullscreen: boolean;
  onAddNote: () => void;
  onChangeVisibility: (visibility: NoteBoardVisibility, memberIds?: string[]) => void;
  onToggleFullscreen: () => void;
}) {
  const t = useTranslations('notes');
  const VisibilityIcon = VISIBILITY_ICON[visibility];

  function renderAccess() {
    if (canChangeVisibility) {
      return (
        <NoteBoardAccessPicker
          projectKey={projectKey}
          visibility={visibility}
          memberIds={memberIds}
          onChange={onChangeVisibility}
        />
      );
    }
    if (visibility === 'restricted') {
      return <NoteBoardAccessList ownerUserId={ownerUserId} memberIds={memberIds} />;
    }
    // Nothing to list on a public or private board: the icon only reports the state.
    return (
      <Tooltip>
        <TooltipTrigger
          aria-label={t('boardAccess')}
          className="flex size-7 cursor-default items-center justify-center rounded-md text-muted-foreground"
        >
          <VisibilityIcon className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{t(`visibilityHint.${visibility}`)}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    // A small floating bar on the canvas (it stays with the canvas in fullscreen, where
    // the header is covered): the sidebar surface, 28px controls, 16px icons.
    <div className="absolute end-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border bg-card p-0.5 shadow-sm">
      {canEdit && (
        <button
          type="button"
          onClick={onAddNote}
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-accent"
        >
          <Plus className="size-4" /> {t('addNote')}
        </button>
      )}
      {renderAccess()}
      <Tooltip>
        <TooltipTrigger
          aria-label={fullscreen ? t('exitFullscreen') : t('fullscreen')}
          onClick={onToggleFullscreen}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </TooltipTrigger>
        <TooltipContent>{fullscreen ? t('exitFullscreen') : t('fullscreen')}</TooltipContent>
      </Tooltip>
    </div>
  );
}
