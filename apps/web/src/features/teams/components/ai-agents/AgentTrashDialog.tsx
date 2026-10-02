'use client';

import { RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Dialog, EmptyState, List, ListRow, Text } from '@/design-system';
import { useAiAgentTrashQuery, useRestoreAiAgent } from '@/services/aiAgents.service';

export default function AgentTrashDialog({
  teamId,
  onClose,
}: {
  teamId: number;
  onClose: () => void;
}) {
  const t = useTranslations('teams.agents');
  const trash = useAiAgentTrashQuery(teamId);
  const restore = useRestoreAiAgent(teamId);
  return (
    <Dialog title={t('trash')} onClose={onClose}>
      {trash.isPending ? (
        <Text>{t('trashLoading')}</Text>
      ) : trash.isError ? (
        <Text tone="danger">{t('trashFailed')}</Text>
      ) : trash.data.length === 0 ? (
        <EmptyState>{t('trashEmpty')}</EmptyState>
      ) : (
        <List>
          {trash.data.map((agent) => (
            <ListRow
              key={agent.id}
              title={agent.name}
              actions={
                <Button
                  icon={<RotateCcw />}
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(agent.id)}
                >
                  {t('restore')}
                </Button>
              }
            />
          ))}
        </List>
      )}
    </Dialog>
  );
}
