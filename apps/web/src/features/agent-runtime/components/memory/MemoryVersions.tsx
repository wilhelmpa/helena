'use client';

import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { EmptyState, List, ListRow, Pill, Stack, TextDiff } from '@/design-system';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { MemoryRevision } from '@/lib/api/endpoints/agentRuntime';
import { useMemoryRevisions } from '../../services/agentRuntime.service';

// Every version of the memory files Ava saw, newest first, each next to the one before it of
// the same file; who wrote it (the agent, you, found in the runtime).
export default function MemoryVersions({ teamId, agentId }: { teamId: number; agentId: number }) {
  const t = useTranslations('agentPages.memory.versions');
  const format = useFormatter();
  const revisions = useMemoryRevisions(teamId, agentId);
  const [open, setOpen] = useState<number | null>(null);
  const previous = useMemo(() => {
    const map = new Map<number, MemoryRevision | undefined>();
    const rows = revisions.data ?? [];
    rows.forEach((row, index) =>
      map.set(
        row.id,
        rows.slice(index + 1).find((older) => older.file === row.file),
      ),
    );
    return map;
  }, [revisions.data]);

  if (revisions.isPending) return <ListSkeleton rows={3} rowClassName="h-9" />;
  if (!revisions.data?.length) {
    return (
      <EmptyState fill={false} icon={<History />} title={t('empty')}>
        {t('emptyHint')}
      </EmptyState>
    );
  }
  return (
    <List label={t('title')}>
      {revisions.data.map((revision) => {
        const isOpen = open === revision.id;
        return (
          <div key={revision.id}>
            <ListRow
              title={t(`file.${revision.file === 'USER.md' ? 'user' : 'memory'}`)}
              subtitle={[
                t(`source.${revision.source}`),
                revision.userName,
                format.dateTime(new Date(revision.createdAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              ]
                .filter(Boolean)
                .join(' · ')}
              meta={<Pill>{revision.file}</Pill>}
              selected={isOpen}
              onSelect={() => setOpen(isOpen ? null : revision.id)}
            />
            {isOpen && (
              <Stack padX={3} padBottom={3}>
                <TextDiff
                  before={previous.get(revision.id)?.content ?? ''}
                  after={revision.content}
                />
              </Stack>
            )}
          </div>
        );
      })}
    </List>
  );
}
