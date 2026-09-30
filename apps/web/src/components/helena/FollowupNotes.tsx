'use client';

import { useTranslations } from 'next-intl';
import { Pill } from '@/design-system';
import type { Followup } from '@/lib/api/endpoints/agentFollowups';
import FollowupIcon from './FollowupIcon';

// The instructions the member gave while an answer was running, under that answer: what
// they said, how it was sent (inject / after / replace) and whether the agent has taken it
// over yet — "wartet" until it does. One quiet line each, on the member's side like their
// own messages.
export default function FollowupNotes({
  items,
  onOpenNext,
}: {
  items: Followup[];
  // An "after" instruction the server made the next run: opens it (a run view has a list
  // of runs to open it in; the chat shows the next turn as its own question instead).
  onOpenNext?: (id: number) => void;
}) {
  const t = useTranslations('chatWorkspace.followups');
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col items-end gap-1.5" aria-label={t('listLabel')}>
      {items.map((item) => (
        <li
          key={item.id}
          className="flex max-w-[80%] min-w-0 flex-col items-end gap-1"
          data-followup-mode={item.mode}
          data-followup-state={item.state}
        >
          <p
            dir="auto"
            className="rounded-xl bg-muted px-3 py-1.5 text-start text-sm break-words whitespace-pre-wrap"
          >
            {item.prompt}
          </p>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FollowupIcon mode={item.mode} className="size-3.5" />
            {t(`mode.${item.mode}`)}
            <Pill tone={item.state === 'applied' ? 'success' : 'neutral'}>
              {t(`state.${item.state}`)}
            </Pill>
            {onOpenNext && item.state === 'queued' && item.nextId != null && (
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => onOpenNext(item.nextId!)}
              >
                {t('openNext')}
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
