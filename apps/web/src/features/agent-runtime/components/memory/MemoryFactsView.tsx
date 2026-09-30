'use client';

import { useMemo, useState } from 'react';
import { Check, Lightbulb, Pencil, Trash2, TriangleAlert } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  ActionMenu,
  Button,
  EmptyState,
  Inline,
  Pill,
  SearchField,
  Stack,
  Text,
  TextArea,
} from '@/design-system';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import type { AgentFact } from '@/lib/api/endpoints/agentRuntime';
import { useAgentFacts, useCorrectFact } from '../../services/agentRuntime.service';

// What the agent keeps as facts, most trusted first, with the trust each earned. The owner
// confirms a fact (it gains trust), corrects its text or removes it; a fact that another one
// may contradict is marked.
export default function MemoryFactsView({
  teamId,
  agentId,
  canEdit,
}: {
  teamId: number;
  agentId: number;
  canEdit: boolean;
}) {
  const t = useTranslations('agentPages.memory.facts');
  const facts = useAgentFacts(teamId, agentId);
  const correct = useCorrectFact(teamId, agentId);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<AgentFact | null>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(facts.data ?? [])]
      .filter(
        (fact) => !needle || `${fact.content} ${fact.category}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.trust - a.trust);
  }, [facts.data, query]);

  if (facts.isPending) return <ListSkeleton rows={4} rowClassName="h-12" />;
  if (!facts.data?.length) {
    return (
      <EmptyState fill={false} icon={<Lightbulb />} title={t('empty')}>
        {t('emptyHint')}
      </EmptyState>
    );
  }
  return (
    <Stack gap={3}>
      <Inline gap={3} justify="between" wrap>
        <Text size="sm" tone="muted">
          {t('count', { count: shown.length })}
        </Text>
        <SearchField
          className="ds-skills-search"
          value={query}
          placeholder={t('search')}
          aria-label={t('search')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Inline>
      {shown.length === 0 && (
        <Text size="sm" tone="muted">
          {t('noMatch', { query: query.trim() })}
        </Text>
      )}
      <ul className="ds-facts">
        {shown.map((fact) => (
          <li key={fact.id} className="ds-fact">
            {editing === fact.id ? (
              <FactEditor
                fact={fact}
                busy={correct.isPending}
                onCancel={() => setEditing(null)}
                onSave={(content) =>
                  correct.mutate({ id: fact.id, content }, { onSuccess: () => setEditing(null) })
                }
              />
            ) : (
              <FactRow
                fact={fact}
                canEdit={canEdit}
                onConfirm={() =>
                  correct.mutate({
                    id: fact.id,
                    trust: Math.min(1, Math.round((fact.trust + 0.1) * 100) / 100),
                  })
                }
                onEdit={() => setEditing(fact.id)}
                onRemove={() => setRemoving(fact)}
              />
            )}
          </li>
        ))}
      </ul>
      {removing && (
        <ConfirmDialog
          title={t('removeTitle')}
          confirmLabel={t('remove')}
          onConfirm={async () => {
            await correct.mutateAsync({ id: removing.id, remove: true });
            setRemoving(null);
          }}
          onClose={() => setRemoving(null)}
        >
          <p>{t('removeBody', { fact: removing.content })}</p>
        </ConfirmDialog>
      )}
    </Stack>
  );
}

function FactRow({
  fact,
  canEdit,
  onConfirm,
  onEdit,
  onRemove,
}: {
  fact: AgentFact;
  canEdit: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('agentPages.memory.facts');
  const format = useFormatter();
  // The agent names a category itself; the usual ones read in the person's language.
  const categoryLabel = (category: string) =>
    t.has(`categories.${category}` as 'categories.general')
      ? t(`categories.${category}` as 'categories.general')
      : category;
  const percent = Math.round(fact.trust * 100);
  return (
    <>
      <div className="ds-fact-main">
        <p dir="auto">{fact.content}</p>
        <Inline gap={2} wrap>
          <Pill>{categoryLabel(fact.category)}</Pill>
          {fact.project && <Pill>{fact.project}</Pill>}
          <span
            className="ds-fact-trust"
            title={t('trustHint', {
              confirmations: fact.confirmations,
              helpful: fact.helpful,
            })}
          >
            <span className="ds-fact-trust-bar" aria-hidden="true">
              <span style={{ inlineSize: `${percent}%` }} />
            </span>
            {t('trust', { value: percent })}
          </span>
          {fact.contradictedBy != null && (
            <Pill tone="warning" icon={<TriangleAlert />}>
              {t('contradicted')}
            </Pill>
          )}
          <Text size="xs" tone="faint">
            {format.dateTime(new Date(fact.updatedAt), { dateStyle: 'medium' })}
          </Text>
        </Inline>
      </div>
      {canEdit && (
        <ActionMenu
          label={t('menu')}
          items={[
            { id: 'confirm', label: t('confirm'), icon: <Check />, onSelect: onConfirm },
            { id: 'edit', label: t('edit'), icon: <Pencil />, onSelect: onEdit },
            {
              id: 'remove',
              label: t('remove'),
              icon: <Trash2 />,
              danger: true,
              onSelect: onRemove,
            },
          ]}
        />
      )}
    </>
  );
}

function FactEditor({
  fact,
  busy,
  onSave,
  onCancel,
}: {
  fact: AgentFact;
  busy: boolean;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('agentPages.memory.facts');
  const [text, setText] = useState(fact.content);
  return (
    <Stack gap={2} grow>
      <TextArea
        rows={2}
        value={text}
        maxLength={500}
        dir="auto"
        aria-label={t('edit')}
        onChange={(event) => setText(event.target.value)}
      />
      <Inline gap={2} justify="end">
        <Button size="small" onClick={onCancel} disabled={busy}>
          {t('cancel')}
        </Button>
        <Button
          size="small"
          variant="primary"
          disabled={busy || !text.trim() || text.trim() === fact.content}
          onClick={() => onSave(text.trim())}
        >
          {t('save')}
        </Button>
      </Inline>
    </Stack>
  );
}
