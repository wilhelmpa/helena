import Link from 'next/link';
import { ArrowUpRight, MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useShell } from '@/context/shellContext';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { activityDetails } from '../utils/activityDetails';
import { openRun } from '@/features/agent-runtime/runOverlay';

export default function AgentActivityDetails({ entry }: { entry: AgentActivityEntry }) {
  const t = useTranslations('agentActivity');
  const { onOpenChatThread } = useShell();
  const target = activityDetails(entry);
  if (!target) return null;

  if (target.kind === 'chat')
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7"
        aria-label={t('openChat')}
        onClick={() => onOpenChatThread(target.agentId, target.threadId)}
      >
        <MessageSquare />
        <span className="max-sm:hidden">{t('openChat')}</span>
      </Button>
    );
  if (target.kind === 'run')
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7"
        aria-label={t('openRun')}
        onClick={() => openRun(target.agentId, target.runId)}
      >
        <ArrowUpRight />
        <span className="max-sm:hidden">{t('openRun')}</span>
      </Button>
    );
  return (
    <Button asChild variant="ghost" size="sm" className="h-7">
      <Link href={target.href} aria-label={t('openRun')}>
        <ArrowUpRight />
        <span className="max-sm:hidden">{t('openRun')}</span>
      </Link>
    </Button>
  );
}
