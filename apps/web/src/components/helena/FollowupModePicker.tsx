'use client';

import { useTranslations } from 'next-intl';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FollowupMode } from '@/lib/api/endpoints/agentFollowups';
import FollowupIcon from './FollowupIcon';

// How what is typed while the agent works goes in: Einschieben (taken over at the next
// step, the default), Danach (asked once the answer is done) or Stoppen und ersetzen.
// Only the modes the agent's runtime supports are offered; a single one is not a choice
// and shows no picker. Sits next to the send button, like the model picker beside it.
export default function FollowupModePicker({
  modes,
  mode,
  onChange,
  showLabel = false,
}: {
  modes: FollowupMode[];
  mode: FollowupMode;
  onChange: (mode: FollowupMode) => void;
  // The mode's name beside its icon always; in the composer it shows by the composer's width.
  showLabel?: boolean;
}) {
  const t = useTranslations('chatWorkspace.followups');
  if (modes.length < 2) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2 text-xs font-normal text-muted-foreground hover:text-foreground data-[state=open]:bg-accent"
          aria-label={t('modeLabel')}
          title={t(`hint.${mode}`)}
        >
          <FollowupIcon mode={mode} className="size-3.5 shrink-0" />
          <span className={showLabel ? 'inline' : 'hidden @md/composer:inline'}>
            {t(`mode.${mode}`)}
          </span>
          <ChevronDown className="size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-72">
        <DropdownMenuLabel>{t('modeLabel')}</DropdownMenuLabel>
        {modes.map((entry) => (
          <DropdownMenuItem
            key={entry.toString()}
            onSelect={() => onChange(entry)}
            className="items-start gap-2"
          >
            <FollowupIcon mode={entry} className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block">{t(`mode.${entry}`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`hint.${entry}`)}</span>
            </span>
            {entry === mode && <Check className="mt-0.5 size-4 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
