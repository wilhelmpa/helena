'use client';

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { EmptyState, List, ListRow, Stack } from '@/design-system';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { useAgentNotes } from '../../services/agentRuntime.service';
import { noteLines } from '../../utils/memoryEntries';

// The daily notes of the agent, newest day first. A note is a line per thing the agent wrote
// down that day, with the time; the agent adds to it without asking, and the nightly tidy-up
// takes what lasts into the memory.
export default function MemoryNotesView({ teamId, agentId }: { teamId: number; agentId: number }) {
  const t = useTranslations('agentPages.memory.notes');
  const format = useFormatter();
  const notes = useAgentNotes(teamId, agentId);
  const [open, setOpen] = useState<string | null>(null);

  if (notes.isPending) return <ListSkeleton rows={4} rowClassName="h-9" />;
  if (!notes.data?.length) {
    return (
      <EmptyState fill={false} icon={<CalendarDays />} title={t('empty')}>
        {t('emptyHint')}
      </EmptyState>
    );
  }
  return (
    <List label={t('title')}>
      {notes.data.map((note) => {
        const lines = noteLines(note.content);
        const isOpen = (open ?? notes.data[0]?.day) === note.day;
        return (
          <div key={note.day}>
            <ListRow
              icon={<CalendarDays />}
              title={format.dateTime(new Date(`${note.day}T12:00:00`), {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              meta={t('lines', { count: lines.length })}
              selected={isOpen}
              onSelect={() => setOpen(isOpen ? '' : note.day)}
            />
            {isOpen && (
              <Stack gap={2} className="ds-note-lines" padStart={5} padEnd={3} padY={3}>
                {lines.map((line, index) => (
                  <div key={index} className="ds-note-line">
                    <span className="ds-note-time">{line.time ?? ''}</span>
                    <span dir="auto">{line.text}</span>
                  </div>
                ))}
              </Stack>
            )}
          </div>
        );
      })}
    </List>
  );
}
