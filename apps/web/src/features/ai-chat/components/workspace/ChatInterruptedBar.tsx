'use client';

import { CirclePause, PlugZap, RefreshCw, RotateCw, TriangleAlert, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { Button } from '@/components/ui/button';
import type { PlanChat } from '../../hooks/usePlanChat';

type Interruption = 'lost' | 'stopped' | 'failed' | 'send-failed';

// Why the last turn did not end the normal way, if it did not.
function interruptionOf(plan: PlanChat): Interruption | null {
  if (plan.busy) return null;
  const last = plan.messages.at(-1);
  if (!last) return null;
  if (last.role === 'user') return plan.status === 'error' ? 'send-failed' : null;
  if (last.metadata?.interrupted) return 'lost';
  if (last.metadata?.stopped) return 'stopped';
  if (last.metadata?.error) return 'failed';
  return null;
}

// "Interrupted — continue?": shown under the last turn when its answer did not finish
// normally, with the way to pick it up that fits why.
// - lost: the browser lost the stream, the answer may still be running — follow it again.
// - stopped / failed: the answer ended early (stopped by the member, or the runner gave
//   up after its retries) — ask the agent to go on from there in the same session, or
//   answer the question again.
// - send-failed: the question never reached the server — send it again.
export default function ChatInterruptedBar({ plan, agent }: { plan: PlanChat; agent: AiAgent }) {
  const t = useTranslations('chatWorkspace');
  const interruption = interruptionOf(plan);
  if (!interruption) return null;

  const icon = {
    lost: PlugZap,
    stopped: CirclePause,
    failed: TriangleAlert,
    'send-failed': TriangleAlert,
  }[interruption];
  const Icon = icon;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-sidebar-border px-3 py-2 text-sm"
    >
      <Icon className="size-4 shrink-0 text-status-waiting" />
      <span className="min-w-0 flex-1 text-muted-foreground">
        {t(`interrupted.${interruption === 'send-failed' ? 'sendFailed' : interruption}`, {
          agent: agent.name,
        })}
      </span>
      <div className="flex items-center gap-1">
        {interruption === 'lost' && (
          <Button size="sm" variant="ghost" className="h-7" onClick={() => void plan.reconnect()}>
            <RotateCw className="size-3.5" /> {t('interrupted.reconnect')}
          </Button>
        )}
        {(interruption === 'stopped' || interruption === 'failed') && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => void plan.send(t('interrupted.continuePrompt'), { agentId: agent.id })}
            >
              <Play className="size-3.5" /> {t('interrupted.continue')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => void plan.regenerate()}
            >
              <RefreshCw className="size-3.5" /> {t('messages.regenerate')}
            </Button>
          </>
        )}
        {interruption === 'send-failed' && (
          <Button size="sm" variant="ghost" className="h-7" onClick={() => void plan.retrySend()}>
            <RotateCw className="size-3.5" /> {t('interrupted.resend')}
          </Button>
        )}
      </div>
    </div>
  );
}
