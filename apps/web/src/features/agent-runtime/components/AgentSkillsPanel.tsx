'use client';

import { Fragment, useMemo, useState } from 'react';
import { Archive, BookOpen, Download, Package, Pin, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  ActionMenu,
  EmptyState,
  Inline,
  List,
  ListGroup,
  ListRow,
  Notice,
  SearchField,
  Segmented,
  Stack,
  Switch,
  Text,
} from '@/design-system';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { AgentPage, AgentPages } from '@/features/teams/components/ai-agents/AgentPage';
import {
  useNativeSkillsQuery,
  useQueueRuntimeAction,
} from '@/features/teams/services/agentLearning.service';
import {
  useAgentSkillsQuery,
  useSetAgentSkills,
  useSkillOptionsQuery,
} from '@/services/agentSkills.service';
import { useUpdateAiAgent } from '@/services/aiAgents.service';
import { useTeamQuery } from '@/services/teams.service';
import { teamSectionPath } from '@/utils/paths';
import Link from 'next/link';
import {
  groupByKind,
  inView,
  matchesQuery,
  pendingChange,
  skillEntries,
  type SkillEntry,
  type SkillKind,
  type SkillView,
} from '../utils/skillEntries';
import SkillDetail from './skills/SkillDetail';

const KIND_ICON: Record<SkillKind, React.ReactNode> = {
  learned: <Sparkles />,
  library: <BookOpen />,
  installed: <Download />,
  bundled: <Package />,
};

// The agent's skills as one calm list instead of a switch per skill: what it has on, by where
// each one came from; the team's library to add from; what it proposes and waits for you;
// what was put away. A skill opens as its own page with its text and, for one the agent
// learned, its versions.
export default function AgentSkillsPanel({
  teamId,
  agent,
  canEdit,
  onOpenTab,
  embedded = false,
}: {
  teamId: number;
  agent: AiAgent;
  canEdit: boolean;
  onOpenTab: (tab: string) => void;
  // Inside a page of the settings, which has the scroll container already.
  embedded?: boolean;
}) {
  const t = useTranslations('agentPages.skills');
  const team = useTeamQuery(teamId).data;
  const canManageLibrary = team?.permissions.agent_skills.edit ?? false;
  const canPromote =
    canEdit && (team?.permissions.agent_skills.create ?? false) && canManageLibrary;
  const policy = agent.runtimePolicy;
  const canReadLibrary = team?.permissions.agent_skills.read ?? false;
  const library = useSkillOptionsQuery(canReadLibrary ? teamId : null);
  const assigned = useAgentSkillsQuery(teamId, canReadLibrary ? agent.id : null);
  const native = useNativeSkillsQuery(teamId, agent.id);
  const setLinks = useSetAgentSkills(teamId);
  const update = useUpdateAiAgent(teamId);
  const queue = useQueueRuntimeAction(teamId, agent.id, agent.runtimePolicy.runtime === 'helena');
  const [view, setView] = useState<SkillView>('assigned');
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const entries = useMemo(
    () =>
      skillEntries({
        library: library.data ?? [],
        assignedIds: (assigned.data ?? []).map((skill) => skill.id),
        inventory: agent.runtimeState.inventory?.skills ?? [],
        disabled: policy.skillsDisabled ?? [],
        native: native.data ?? [],
      }),
    [library.data, assigned.data, agent.runtimeState.inventory, policy.skillsDisabled, native.data],
  );
  const counts = useMemo(
    () => ({
      assigned: inView(entries, 'assigned').length,
      library: inView(entries, 'library').length,
      proposals: inView(entries, 'proposals').length,
      archive: inView(entries, 'archive').length,
    }),
    [entries],
  );

  const loading = (canReadLibrary && (library.isPending || assigned.isPending)) || native.isPending;
  const open = openKey ? (entries.find((entry) => entry.key === openKey) ?? null) : null;
  const Frame = embedded ? Fragment : AgentPages;
  if (open) {
    return (
      <Frame>
        <SkillDetail
          teamId={teamId}
          agentId={agent.id}
          entry={open}
          canEdit={canEdit}
          canPromote={canPromote}
          onBack={() => setOpenKey(null)}
          onOpenSessions={
            agent.runtimeState.capabilities.includes('sessions')
              ? () => onOpenTab('sessions')
              : null
          }
        />
      </Frame>
    );
  }

  const shown = inView(entries, view).filter((entry) => matchesQuery(entry, query));
  const groups = groupByKind(shown);

  function toggle(entry: SkillEntry, on: boolean) {
    if (entry.libraryId != null) {
      const ids = new Set((assigned.data ?? []).map((skill) => skill.id));
      if (on) ids.add(entry.libraryId);
      else ids.delete(entry.libraryId);
      setLinks.mutate({ agentId: agent.id, skillIds: [...ids] });
      return;
    }
    const disabled = new Set(policy.skillsDisabled ?? []);
    if (on) disabled.delete(entry.loadName);
    else disabled.add(entry.loadName);
    update.mutate({
      id: agent.id,
      patch: { runtimePolicy: { ...policy, skillsDisabled: [...disabled] } },
    });
  }

  const views: { value: SkillView; label: string; count: number }[] = [
    { value: 'assigned', label: t('views.assigned'), count: counts.assigned },
    { value: 'library', label: t('views.library'), count: counts.library },
    { value: 'proposals', label: t('views.proposals'), count: counts.proposals },
    { value: 'archive', label: t('views.archive'), count: counts.archive },
  ];

  return (
    <Frame>
      <AgentPage title={t('title')} hint={t('hint')}>
        <Inline gap={3} wrap justify="between">
          <Segmented
            label={t('viewsLabel')}
            value={view}
            onChange={setView}
            options={views
              .filter(
                (entry) =>
                  entry.value === view ||
                  entry.value === 'assigned' ||
                  entry.value === 'library' ||
                  entry.count > 0,
              )
              .map((entry) => ({
                value: entry.value,
                label: (
                  <>
                    {entry.label}
                    <span className="ds-segment-count">{entry.count}</span>
                  </>
                ),
              }))}
          />
          <SearchField
            className="ds-skills-search"
            value={query}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Inline>

        {view !== 'proposals' && counts.proposals > 0 && (
          <Notice
            tone="warning"
            title={t('proposalsTitle', { count: counts.proposals })}
            action={
              <button type="button" className="ds-link-button" onClick={() => setView('proposals')}>
                {t('proposalsOpen')}
              </button>
            }
          >
            {t('proposalsText')}
          </Notice>
        )}

        {loading ? (
          <ListSkeleton rows={6} rowClassName="h-9" />
        ) : shown.length === 0 ? (
          <EmptyState
            fill={false}
            icon={view === 'archive' ? <Archive /> : <Sparkles />}
            title={query.trim() ? t('empty.search', { query: query.trim() }) : t(`empty.${view}`)}
          >
            {!query.trim() && t(`emptyHint.${view}`)}
          </EmptyState>
        ) : (
          <Stack gap={4}>
            {groups.map(([kind, list]) => (
              <ListGroup
                key={`${view}:${kind}`}
                label={t(`kinds.${kind}`)}
                count={list.length}
                defaultOpen={!(kind === 'bundled' && list.length > 8 && !query.trim())}
              >
                <List label={t(`kinds.${kind}`)}>
                  {list.map((entry) => (
                    <SkillRow
                      key={entry.key}
                      entry={entry}
                      canEdit={canEdit}
                      canToggle={
                        entry.kind === 'learned'
                          ? entry.learned == null && canEdit
                          : entry.kind === 'library'
                            ? canManageLibrary
                            : canEdit
                      }
                      onOpen={() => setOpenKey(entry.key)}
                      onToggle={(on) => toggle(entry, on)}
                      onPin={() =>
                        entry.path &&
                        queue.mutate({ kind: 'pin-skill', path: entry.path, pinned: !entry.pinned })
                      }
                      onArchive={() =>
                        entry.path && queue.mutate({ kind: 'discard-skill', path: entry.path })
                      }
                    />
                  ))}
                </List>
              </ListGroup>
            ))}
          </Stack>
        )}

        {canManageLibrary && (
          <Text size="xs" tone="muted">
            {t('libraryHint')}{' '}
            <Link className="ds-link-button" href={teamSectionPath(teamId, 'agent-skills')}>
              {t('libraryOpen')}
            </Link>
          </Text>
        )}
      </AgentPage>
    </Frame>
  );
}

function SkillRow({
  entry,
  canEdit,
  canToggle,
  onOpen,
  onToggle,
  onPin,
  onArchive,
}: {
  entry: SkillEntry;
  canEdit: boolean;
  canToggle: boolean;
  onOpen: () => void;
  onToggle: (on: boolean) => void;
  onPin: () => void;
  onArchive: () => void;
}) {
  const t = useTranslations('agentPages.skills');
  const pending = entry.learned ? pendingChange(entry.learned) : null;
  const showSwitch = entry.kind !== 'learned' || entry.learned == null;
  return (
    <ListRow
      icon={entry.pinned ? <Pin /> : KIND_ICON[entry.kind]}
      title={entry.title}
      subtitle={entry.description || undefined}
      dot={pending || entry.state === 'proposed' ? 'waiting' : null}
      meta={
        <>
          {(pending || entry.state === 'proposed') && (
            <span className="ds-skill-flag">{t('proposal')}</span>
          )}
          {entry.state === 'active' && entry.useCount != null && entry.useCount > 0 && (
            <span title={t('uses', { count: entry.useCount })}>{entry.useCount}×</span>
          )}
        </>
      }
      control={
        showSwitch ? (
          <Switch
            size="sm"
            checked={entry.enabled}
            disabled={!canToggle}
            aria-label={t('switch', { name: entry.title })}
            onCheckedChange={onToggle}
          />
        ) : undefined
      }
      actions={
        entry.kind === 'learned' && entry.learned && canEdit && entry.state === 'active' ? (
          <ActionMenu
            label={t('menu', { name: entry.title })}
            items={[
              { id: 'open', label: t('actions.open'), onSelect: onOpen },
              {
                id: 'pin',
                label: entry.pinned ? t('actions.unpin') : t('actions.pin'),
                icon: <Pin />,
                disabled: pending != null,
                onSelect: onPin,
              },
              {
                id: 'archive',
                label: t('actions.archive'),
                icon: <Archive />,
                disabled: pending != null,
                onSelect: onArchive,
              },
            ]}
          />
        ) : undefined
      }
      onSelect={onOpen}
    />
  );
}
