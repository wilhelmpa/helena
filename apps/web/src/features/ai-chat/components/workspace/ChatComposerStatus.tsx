'use client';

import { Play, RefreshCw, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Marker, MarkerContent } from '@/components/ui/marker';
import type { ComposerActivity } from '../../utils/composerActivity';

// The composer's status line, a shadcn Marker (the component shadcn made for exactly this
// Exceptional interruptions and the actions that recover from them.
export default function ChatComposerStatus({
  activity,
  agentName,
  onReconnect,
  onContinue,
  onRegenerate,
  onResend,
}: {
  activity: ComposerActivity;
  agentName: string;
  onReconnect: () => void;
  onContinue: () => void;
  onRegenerate: () => void;
  onResend: () => void;
}) {
  const t = useTranslations('chatWorkspace');
  if (
    activity === 'idle' ||
    activity === 'answered' ||
    activity === 'thinking' ||
    activity === 'writing' ||
    activity === 'queued'
  )
    return null;

  const text = {
    lost: t('interrupted.lost', { agent: agentName }),
    stopped: t('interrupted.stopped'),
    failed: t('interrupted.failed'),
    sendFailed: t('interrupted.sendFailed'),
  }[activity];

  const action = (label: string, Icon: typeof Play, onClick: () => void) => (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-6 shrink-0 gap-1 px-1.5 text-xs font-normal text-foreground"
      onClick={onClick}
    >
      <Icon className="size-3.5" /> {label}
    </Button>
  );

  return (
    <Marker role="status" className="min-h-6 flex-wrap gap-x-2 px-1 text-xs">
      <MarkerContent className="min-w-0 flex-1">{text}</MarkerContent>
      {activity === 'lost' && action(t('interrupted.reconnect'), RotateCw, onReconnect)}
      {(activity === 'stopped' || activity === 'failed') && (
        <>
          {action(t('interrupted.continue'), Play, onContinue)}
          {action(t('messages.regenerate'), RefreshCw, onRegenerate)}
        </>
      )}
      {activity === 'sendFailed' && action(t('interrupted.resend'), RotateCw, onResend)}
    </Marker>
  );
}
