'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionLabel } from '@/components/common/page/RowList';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { cn } from '@/lib/utils';
import type { AgentFact } from '@/lib/api/endpoints/agentRuntime';
import { useAgentFacts, useAgentNotes, useCorrectFact } from '../services/agentRuntime.service';

// What the agent keeps besides its memory files: the facts of the fact store, with the trust
// each earned (docs/helena-decisions/zentrale-laufzeit.md §8.2), and the daily notes of
// Helena's own runtime. The owner corrects a fact's text or trust, or removes it.
export function AgentFactsSection({
  teamId,
  agentId,
  canEdit,
}: {
  teamId: number;
  agentId: number;
  canEdit: boolean;
}) {
  const t = useTranslations('agentRuntime.memory.facts');
  const facts = useAgentFacts(teamId, agentId);
  if (facts.isPending) return <ListSkeleton rows={2} rowClassName="h-9" />;
  if (!facts.data?.length) return null;
  return (
    <section className="space-y-2">
      <SectionLabel>{t('title', { count: facts.data.length })}</SectionLabel>
      <ul className="divide-y divide-border/50 overflow-hidden rounded-md bg-card">
        {facts.data.map((fact) => (
          <FactRow key={fact.id} fact={fact} teamId={teamId} agentId={agentId} canEdit={canEdit} />
        ))}
      </ul>
    </section>
  );
}

function FactRow({
  fact,
  teamId,
  agentId,
  canEdit,
}: {
  fact: AgentFact;
  teamId: number;
  agentId: number;
  canEdit: boolean;
}) {
  const t = useTranslations('agentRuntime.memory.facts');
  const correct = useCorrectFact(teamId, agentId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.content);
  const trust = Math.round(fact.trust * 100);
  return (
    <li className="space-y-1 px-3 py-2 text-sm">
      {editing ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            correct.mutate(
              { id: fact.id, content: text.trim() },
              { onSuccess: () => setEditing(false) },
            );
          }}
        >
          <Input value={text} onChange={(event) => setText(event.target.value)} maxLength={500} />
          <Button type="submit" size="sm" disabled={!text.trim() || correct.isPending}>
            {t('save')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {t('cancel')}
          </Button>
        </form>
      ) : (
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1">{fact.content}</span>
          <Badge
            variant="outline"
            className={cn('shrink-0', trust < 30 && 'text-muted-foreground')}
            title={t('trustHint', { confirmations: fact.confirmations, helpful: fact.helpful })}
          >
            {t('trust', { value: trust })}
          </Badge>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {fact.project && <span>{fact.project}</span>}
        {fact.entities.length > 0 && <span>{fact.entities.join(', ')}</span>}
        {fact.contradictedBy !== null && <span className="text-warning">{t('contradicted')}</span>}
        {canEdit && !editing && (
          <span className="ms-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {t('edit')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={correct.isPending}
              onClick={() => correct.mutate({ id: fact.id, trust: Math.min(1, fact.trust + 0.2) })}
            >
              {t('confirm')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={correct.isPending}
              onClick={() => correct.mutate({ id: fact.id, remove: true })}
            >
              {t('remove')}
            </Button>
          </span>
        )}
      </div>
    </li>
  );
}

export function AgentNotesSection({ teamId, agentId }: { teamId: number; agentId: number }) {
  const t = useTranslations('agentRuntime.memory.notes');
  const format = useFormatter();
  const notes = useAgentNotes(teamId, agentId);
  const [open, setOpen] = useState<string | null>(null);
  if (!notes.data?.length) return null;
  return (
    <section className="space-y-2">
      <SectionLabel>{t('title')}</SectionLabel>
      <ul className="divide-y divide-border/50 overflow-hidden rounded-md bg-card">
        {notes.data.map((note) => (
          <li key={note.day}>
            <button
              type="button"
              onClick={() => setOpen(open === note.day ? null : note.day)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-accent',
                open === note.day && 'bg-accent',
              )}
            >
              <span className="min-w-0 flex-1">
                {format.dateTime(new Date(`${note.day}T12:00:00`), { dateStyle: 'full' })}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t('lines', { count: note.content.split('\n').filter(Boolean).length })}
              </span>
            </button>
            {open === note.day && (
              <pre className="px-3 pb-3 font-sans text-xs whitespace-pre-wrap text-muted-foreground">
                {note.content}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
