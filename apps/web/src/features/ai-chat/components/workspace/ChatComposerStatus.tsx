'use client';

import { Play, RefreshCw, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { cn } from '@/lib/utils';
import type { ComposerActivity } from '../../utils/composerActivity';

// The composer's status line, a shadcn Marker (the component shadcn made for exactly this
// in a conversation): what the answer is doing right now ("Home denkt nach …", "Home nutzt
// web_search …"), or how it ended when that was not the normal way, with the one or two
// ways to go on from there. Nothing at all while there is nothing to say. A `status`
// region, so a screen reader announces the change.
export default function ChatComposerStatus({
  activity,
  tool,
  agentName,
  onReconnect,
  onContinue,
  onRegenerate,
  onResend,
}: {
  activity: ComposerActivity;
  // The tool the answer is running right now, if any (see activeTool).
  tool: string | null;
  agentName: string;
  onReconnect: () => void;
  onContinue: () => void;
  onRegenerate: () => void;
  onResend: () => void;
}) {
  const t = useTranslations('chatWorkspace');
  if (activity === 'idle' || activity === 'answered') return null;

  const live = activity === 'thinking' || activity === 'writing';
  const text = {
    thinking: tool
      ? t('activity.usingTool', { agent: agentName, tool })
      : t('activity.thinking', { agent: agentName }),
    writing: tool
      ? t('activity.usingTool', { agent: agentName, tool })
      : t('activity.writing', { agent: agentName }),
    queued: t('activity.queued', { agent: agentName }),
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
      <MarkerContent className={cn('min-w-0 flex-1', live && 'shimmer')}>{text}</MarkerContent>
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
