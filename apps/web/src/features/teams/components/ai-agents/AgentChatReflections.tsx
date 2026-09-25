'use client';

import { useTranslations } from 'next-intl';
import { formatDateTime } from '@/utils/dates';
import { useChatReflectionsQuery } from '../../services/agentLearning.service';

// The agent's latest reflections on its chats (docs/helena-decisions/agent-context.md §5):
// which chat, when, what it kept. What went to its memory waits for the owner on the memory
// tab and the approvals page, like every memory write of the agent.
export default function AgentChatReflections({
  teamId,
  agentId,
}: {
  teamId: number;
  agentId: number;
}) {
  const t = useTranslations('teams.agents.abilities.learning');
  const reflections = useChatReflectionsQuery(teamId, agentId).data ?? [];
  if (reflections.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{t('chatReflections')}</p>
      <ul className="space-y-2">
        {reflections.map((reflection) => (
          <li key={reflection.id} className="space-y-0.5">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 truncate">
                {reflection.threadTitle ?? t('chatUntitled')}
              </span>
              <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                {t(`chatReflectionStatus.${reflection.status}`)}
                {' · '}
                {formatDateTime(reflection.finishedAt ?? reflection.dueAt)}
              </span>
            </div>
            {reflection.status === 'success' && (
              <p className="text-xs text-muted-foreground">
                {reflection.saved.length === 0
                  ? t('chatReflectionNothing')
                  : reflection.saved
                      .map((entry) =>
                        entry.tool === 'memory'
                          ? t('chatReflectionMemory', { target: entry.target })
                          : t('chatReflectionSkill', { target: entry.target }),
                      )
                      .join(' · ')}
              </p>
            )}
            {reflection.error && <p className="text-xs text-destructive">{reflection.error}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
