import Link from 'next/link';
import { ArrowUpRight, MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useShell } from '@/context/shellContext';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { activityDetails } from '../utils/activityDetails';

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
        onClick={() => onOpenChatThread(target.agentId, target.threadId)}
      >
        <MessageSquare />
        {t('openChat')}
      </Button>
    );
  return (
    <Button asChild variant="ghost" size="sm" className="h-7">
      <Link href={target.href}>
        <ArrowUpRight />
        {t('openRun')}
      </Link>
    </Button>
  );
}
