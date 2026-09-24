'use client';

import { MonitorCog } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { VideoPreference } from '@/hooks/useBrowserScreencast';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const PREFERENCES: VideoPreference[] = ['auto', 'video', 'jpeg'];

// How the live view is streamed on this device: video or single frames as the connection
// suits (auto), or one of them always; and whether the page keeps its size when this panel
// changes size ("Größe festhalten"), the view then only scaling it.
export default function WorkspaceBrowserStreamMenu({
  videoPreference,
  onVideoPreferenceChange,
  holdSize,
  onToggleHoldSize,
}: {
  videoPreference: VideoPreference;
  onVideoPreferenceChange: (next: VideoPreference) => void;
  holdSize: boolean;
  onToggleHoldSize: () => void;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  const labels: Record<VideoPreference, string> = {
    auto: t('videoPreferenceAuto'),
    video: t('videoPreferenceVideo'),
    jpeg: t('videoPreferenceJpeg'),
  };
  const hints: Record<VideoPreference, string> = {
    auto: t('videoPreferenceAutoHint'),
    video: t('videoPreferenceVideoHint'),
    jpeg: t('videoPreferenceJpegHint'),
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={holdSize || videoPreference !== 'auto' ? 'secondary' : 'ghost'}
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          title={t('stream')}
          aria-label={t('stream')}
        >
          <MonitorCog />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t('stream')}</DropdownMenuLabel>
        {PREFERENCES.map((preference) => (
          <DropdownMenuItem
            key={preference}
            onSelect={() => onVideoPreferenceChange(preference)}
            aria-checked={videoPreference === preference}
            role="menuitemradio"
            className="flex-col items-start gap-0"
          >
            <span className={videoPreference === preference ? 'font-medium' : undefined}>
              {labels[preference]}
            </span>
            <span className="text-xs text-muted-foreground">{hints[preference]}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={holdSize}
          onCheckedChange={() => onToggleHoldSize()}
          className="flex-col items-start gap-0"
        >
          <span>{t('holdSize')}</span>
          <span className="text-xs text-muted-foreground">{t('holdSizeHint')}</span>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
