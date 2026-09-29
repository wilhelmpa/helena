'use client';

import Link from 'next/link';
import { Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { teamSectionPath } from '@/utils/paths';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

// Shown when there is no agent to chat with in this scope at all — a project without an
// external agent yet, or a template-only team. Points at where agents are set up; older
// chats stay reachable in the sidebar.
export default function ChatEmptyState({ teamId }: { teamId: number | null }) {
  const t = useTranslations('chatWorkspace');

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Bot />
          </EmptyMedia>
          <EmptyTitle>{t('empty.noAgentsTitle')}</EmptyTitle>
          <EmptyDescription>{t('empty.noAgentsDescription')}</EmptyDescription>
        </EmptyHeader>
        {teamId != null && (
          <EmptyContent>
            <Button asChild size="sm" variant="outline">
              <Link href={teamSectionPath(teamId, 'ai-agents')}>{t('empty.manageAgents')}</Link>
            </Button>
          </EmptyContent>
        )}
      </Empty>
    </div>
  );
}
