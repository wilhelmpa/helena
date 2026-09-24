'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { NoteBoard } from '@/lib/api/endpoints/noteBoards';
import { useShell } from '@/context/shellContext';
import Avatar from '@/components/common/Avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { SaveStatus } from '../hooks/useCanvasAutosave';

// The canvas label overlay: who made the board and whether it is saved. The name is
// the open tab in the header row, so it shows here only in fullscreen, where the
// header is covered. A board created before the creator was recorded (the column is
// newer than the feature) shows no avatar.
export default function NoteCanvasTitle({
  board,
  saveStatus,
  fullscreen = false,
}: {
  board: NoteBoard;
  saveStatus: SaveStatus;
  fullscreen?: boolean;
}) {
  const { project } = useShell();
  const t = useTranslations('notes');
  const creator = project?.assignees.find((a) => a.userId === board.createdByUserId);

  // The status stays visible while there are unsaved edits, a save is in flight, or
  // a save failed; a successful "Saved" hides a few seconds later. An open board
  // that has not been edited shows nothing (its initial state is already "saved").
  const [showStatus, setShowStatus] = useState(false);
  useEffect(() => {
    if (saveStatus === 'saved') {
      const timer = setTimeout(() => setShowStatus(false), 3000);
      return () => clearTimeout(timer);
    }
    setShowStatus(true);
  }, [saveStatus]);

  return (
    <div className="absolute start-3 top-3 z-10 flex items-center gap-2">
      {creator && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Avatar name={creator.name} image={creator.image} />
          </TooltipTrigger>
          <TooltipContent>{t('createdBy', { name: creator.name })}</TooltipContent>
        </Tooltip>
      )}
      {fullscreen && (
        <span className="text-sm leading-none font-medium text-foreground">{board.name}</span>
      )}
      {showStatus && (
        <span
          className={cn(
            'text-xs leading-none',
            saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {t(`save.${saveStatus}`)}
        </span>
      )}
    </div>
  );
}
