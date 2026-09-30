'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, BookPlus, Pin, PinOff } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button, Inline, Notice, Pill, Segmented, Stack, Text } from '@/design-system';
import Markdown from '@/components/common/Markdown';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { getSkillMarkdown } from '@/lib/api/endpoints/agentSkills';
import { AgentPage } from '@/features/teams/components/ai-agents/AgentPage';
import {
  useLearnedSkillQuery,
  usePromoteLearnedSkill,
  useQueueRuntimeAction,
  useReviewNativeSkill,
} from '@/features/teams/services/agentLearning.service';
import { qk } from '@/services/queryKeys';
import { pendingChange, type SkillEntry } from '../../utils/skillEntries';
import SkillHistory from './SkillHistory';

// The front matter of a SKILL.md is the skill's name and use, which the page shows itself.
function withoutFrontMatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n*/, '');
}

// One skill of the agent: what it is for, its text and files, and for one the agent learned
// its versions with the owner's decisions (apply a proposal, reject it, pin, archive, bring
// back, take into the library).
export default function SkillDetail({
  teamId,
  agentId,
  entry,
  canEdit,
  canPromote,
  onBack,
  onOpenSessions,
}: {
  teamId: number;
  agentId: number;
  entry: SkillEntry;
  canEdit: boolean;
  canPromote: boolean;
  onBack: () => void;
  onOpenSessions: (() => void) | null;
}) {
  const t = useTranslations('agentPages.skills');
  const format = useFormatter();
  const relative = useRelativeTime();
  const skill = entry.learned;
  const pending = skill ? pendingChange(skill) : null;
  const versions = skill?.history?.length ?? 0;
  const [tab, setTab] = useState<'content' | 'history'>(pending ? 'history' : 'content');
  const queue = useQueueRuntimeAction(teamId, agentId, skill != null);
  const review = useReviewNativeSkill(teamId, agentId);
  const promote = usePromoteLearnedSkill(teamId, agentId);
  const busy = queue.isPending || review.isPending || promote.isPending;

  // The text: the skill's own for one the agent learned with its history, the runtime's
  // report for one without, the library's markdown for a library skill.
  const reported = useLearnedSkillQuery(
    teamId,
    agentId,
    entry.kind === 'learned' && !skill && entry.path ? entry.path : null,
  );
  const libraryMarkdown = useQuery({
    queryKey: qk.agentSkill(teamId, entry.libraryId ?? 0),
    queryFn: () => getSkillMarkdown(teamId, entry.libraryId!),
    enabled: entry.libraryId != null,
  });
  const markdown =
    skill?.markdown ?? reported.data?.markdown ?? libraryMarkdown.data?.markdown ?? null;
  const files = skill?.files ?? reported.data?.files ?? [];
  const loading = reported.isLoading || libraryMarkdown.isLoading;

  const actions =
    entry.kind === 'learned' && canEdit ? (
      <Inline gap={2} wrap>
        {entry.state === 'archived' && skill && (
          <Button
            icon={<ArchiveRestore />}
            disabled={busy}
            onClick={() =>
              review.mutate({ path: skill.path, revision: skill.revision, action: 'restore' })
            }
          >
            {t('actions.restore')}
          </Button>
        )}
        {entry.state === 'active' && entry.path && (
          <>
            <Button
              icon={entry.pinned ? <PinOff /> : <Pin />}
              disabled={busy || pending != null}
              onClick={() =>
                queue.mutate({ kind: 'pin-skill', path: entry.path!, pinned: !entry.pinned })
              }
            >
              {entry.pinned ? t('actions.unpin') : t('actions.pin')}
            </Button>
            <Button
              icon={<Archive />}
              disabled={busy || pending != null}
              onClick={() => {
                queue.mutate({ kind: 'discard-skill', path: entry.path! }, { onSuccess: onBack });
              }}
            >
              {t('actions.archive')}
            </Button>
            {canPromote && (
              <Button
                icon={<BookPlus />}
                disabled={busy}
                onClick={() => promote.mutate(entry.path!, { onSuccess: onBack })}
              >
                {t('actions.promote')}
              </Button>
            )}
          </>
        )}
      </Inline>
    ) : null;

  return (
    <AgentPage
      title={entry.title}
      hint={entry.description || undefined}
      back={{ label: t('back'), onClick: onBack }}
    >
      <Inline gap={2} wrap>
        <Pill tone={entry.kind === 'learned' ? 'accent' : 'neutral'}>
          {t(`kinds.${entry.kind}`)}
        </Pill>
        {entry.state === 'proposed' && <Pill tone="warning">{t('proposal')}</Pill>}
        {entry.state === 'archived' && <Pill>{t('archived')}</Pill>}
        {entry.pinned && <Pill icon={<Pin />}>{t('pinned')}</Pill>}
        {entry.version != null && entry.version > 0 && (
          <Pill>{t('version', { version: entry.version })}</Pill>
        )}
        {entry.useCount != null && <Pill>{t('uses', { count: entry.useCount })}</Pill>}
        {entry.lastUsedAt && (
          <Text size="xs" tone="muted">
            {t('lastUsed', { when: relative(entry.lastUsedAt) })}
          </Text>
        )}
        <Text size="xs" tone="muted" mono title={t('loadNameHint')}>
          {entry.loadName}
        </Text>
      </Inline>

      {actions}

      {skill && pending && (
        <Notice tone="warning" title={t('pendingTitle')}>
          {t('pendingText', {
            when: format.dateTime(new Date(pending.at), {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })}
        </Notice>
      )}

      {skill && (
        <Segmented
          label={t('viewsLabel')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'content', label: t('tabs.content') },
            { value: 'history', label: t('tabs.history', { count: versions }) },
          ]}
        />
      )}

      {tab === 'history' && skill ? (
        <SkillHistory
          skill={skill}
          canReview={canEdit}
          busy={busy}
          onOpenSession={onOpenSessions}
          onReview={(action) =>
            review.mutate({ path: skill.path, revision: skill.revision, action })
          }
        />
      ) : loading ? (
        <ListSkeleton rows={4} rowClassName="h-5" />
      ) : markdown ? (
        <Stack gap={4}>
          <div className="ds-skill-text">
            <Markdown>{withoutFrontMatter(markdown)}</Markdown>
          </div>
          {files.map((file) => (
            <Stack key={file.path} gap={1}>
              <Text size="xs" tone="muted" mono>
                {file.path}
              </Text>
              <div className="ds-skill-text">
                <Markdown>{file.content}</Markdown>
              </div>
            </Stack>
          ))}
        </Stack>
      ) : (
        <Text size="sm" tone="muted">
          {entry.kind === 'bundled' || entry.kind === 'installed'
            ? t('runtimeSkill')
            : t('noContent')}
        </Text>
      )}
    </AgentPage>
  );
}
