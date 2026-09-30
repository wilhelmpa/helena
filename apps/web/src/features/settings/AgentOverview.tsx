'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  Button,
  List,
  ListRow,
  MonoLabel,
  SettingsGroup,
  SettingsRow,
  StatusPill,
} from '@/design-system';
import BudgetBar, { fullestBudget } from '@/components/helena/BudgetBar';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { Organization, OrganizationAgent } from '@/lib/api/endpoints/organization';
import { useOrganizationQuery } from '@/features/organization/services/organization.service';
import { useAgentRuns } from '@/services/aiAgents.service';
import { RunRow } from '@/features/agent-runtime/components/AgentRunsPanel';
import { useRuntimeSessions } from '@/features/agent-runtime/services/agentRuntime.service';
import { sessionTitle } from '@/features/agent-runtime/utils/sessionTitle';
import { formatBudgetAmount } from '@/features/autopilot/utils/autopilotFormat';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { useAgentStatus } from '@/utils/helenaStatus';

// The goals an agent works for (the "Warum" of the side panel): the goals its tasks are
// linked to, else the active goals of its projects and its department; Home works for
// the top goals.
function agentGoals(organization: Organization, agent: OrganizationAgent) {
  const open = organization.goals.filter(
    (goal) => goal.status === 'active' || goal.status === 'planned',
  );
  const working = open.filter((goal) =>
    goal.progress?.agents.some((entry) => entry.id === agent.id),
  );
  if (working.length) return working;
  if (agent.isHome) return open.filter((goal) => goal.parentGoalId == null);
  const projects = new Set(agent.projects.map((project) => project.id));
  return open.filter(
    (goal) =>
      (goal.projectId != null && projects.has(goal.projectId)) ||
      (goal.departmentId != null && goal.departmentId === agent.departmentId),
  );
}

// An agent at a glance (docs/paperclip-assimilation.md §3 "Seitenfeld nach Klick"): what it
// can do, its state, heartbeat, budget, model and what for, and its latest results. The
// org chart opens the agent here; "Alle Einstellungen" leads to the full settings, so no
// function is lost.
export default function AgentOverview({
  teamId,
  agent,
  onSettings,
  onRun,
  onTab,
}: {
  teamId: number;
  agent: AiAgent | null;
  onSettings: () => void;
  onRun: (runId: number) => void;
  // Opens another tab of the agent (all runs, all sessions).
  onTab: (tab: string) => void;
}) {
  const t = useTranslations('teams.agents.overview');
  const tChart = useTranslations('organization.chart');
  const locale = useLocale();
  const relative = useRelativeTime();
  const organization = useOrganizationQuery(teamId).data;
  const runs = useAgentRuns(teamId, agent?.id ?? null);
  const sessions = useRuntimeSessions(teamId, agent?.id ?? 0, { q: '', offset: 0 });
  const status = useAgentStatus(agent?.id ?? 0);
  const member = organization?.agents.find((entry) => entry.id === agent?.id) ?? null;
  if (!agent || !organization) return <ListSkeleton rows={6} rowClassName="h-10" />;

  const kind = member?.isHome
    ? tChart('home')
    : member?.role === 'coordinator'
      ? tChart('coordinator')
      : member?.role === 'reviewer'
        ? tChart('reviewer')
        : tChart('specialist');
  const department = organization.departments.find((entry) => entry.id === member?.departmentId);
  const capabilities = member?.capabilities.length ? member.capabilities : [];
  const about = member?.roleTitle || '';
  const budget = fullestBudget(member?.budgets);
  const goals = member ? agentGoals(organization, member) : [];
  const latest = (runs.data?.pages.flatMap((page) => page.items) ?? []).slice(0, 5);
  const recentSessions = agent.runtimeState.capabilities.includes('sessions')
    ? (sessions.data?.page?.sessions ?? []).slice(0, 4)
    : [];
  const every = agent.heartbeatIntervalMinutes;
  const next = agent.heartbeatNextAt ? new Date(agent.heartbeatNextAt) : null;
  const time = (date: Date) =>
    new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
  const reasoning = agent.runtimePolicy.reasoningEffort;

  return (
    <div className="ds-agent-overview">
      <header className="ds-agent-overview-head">
        <MonoLabel>{[kind, department?.name].filter(Boolean).join(' · ')}</MonoLabel>
        {about && <p className="ds-agent-overview-about">{about}</p>}
        {capabilities.length > 0 ? (
          <ul className="ds-agent-overview-caps" aria-label={t('capabilities')}>
            {capabilities.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        ) : (
          !about && <p className="ds-agent-overview-about">{t('noCapabilities')}</p>
        )}
      </header>

      <SettingsGroup>
        <SettingsRow label={t('status')}>
          <StatusPill status={member?.throttled ? 'throttled' : status} />
        </SettingsRow>
        <SettingsRow
          label={t('heartbeat')}
          description={every && next ? t('heartbeatNext', { time: time(next) }) : undefined}
        >
          <span className="ds-agent-overview-value">
            {every ? t('heartbeatEvery', { minutes: every }) : t('heartbeatOff')}
          </span>
        </SettingsRow>
        <SettingsRow
          label={t('budget')}
          description={
            budget
              ? t('budgetOf', {
                  used: formatBudgetAmount(budget.metric, budget.used, locale),
                  limit: formatBudgetAmount(budget.metric, budget.limit, locale),
                })
              : undefined
          }
        >
          {budget ? (
            <BudgetBar
              budget={budget}
              className="ds-agent-overview-budget"
              label={tChart('budgetUsed', { percent: Math.round(budget.ratio * 100) })}
            />
          ) : (
            <span className="ds-agent-overview-value">{t('noBudget')}</span>
          )}
        </SettingsRow>
        <SettingsRow label={t('model')}>
          <span className="ds-agent-overview-value">
            {[agent.model ?? tChart('standardModel'), reasoning].filter(Boolean).join(' · ')}
          </span>
        </SettingsRow>
        {/* Long goal titles wrap below the label instead of running out of the card. */}
        <SettingsRow label={t('why')} stacked={goals.length > 0}>
          {goals.length ? (
            <ul className="ds-agent-overview-goals">
              {goals.map((goal) => (
                <li key={goal.id}>{goal.title}</li>
              ))}
            </ul>
          ) : (
            <span className="ds-agent-overview-value">{t('noWhy')}</span>
          )}
        </SettingsRow>
      </SettingsGroup>

      <section className="ds-agent-overview-results">
        <MonoLabel>{t('latestResults')}</MonoLabel>
        {runs.isPending ? (
          <ListSkeleton rows={3} rowClassName="h-10" />
        ) : latest.length === 0 ? (
          <p className="ds-agent-overview-about">{t('noResults')}</p>
        ) : (
          <List label={t('latestResults')}>
            {latest.map((run) => (
              <RunRow key={run.id} run={run} onOpen={() => onRun(run.id)} />
            ))}
          </List>
        )}
      </section>

      {recentSessions.length > 0 && (
        <section className="ds-agent-overview-results">
          <MonoLabel>{t('latestSessions')}</MonoLabel>
          <List label={t('latestSessions')}>
            {recentSessions.map((session) => (
              <ListRow
                key={session.id}
                title={sessionTitle(session, t('sessionUntitled'))}
                subtitle={t('sessionMessages', { count: session.messageCount })}
                meta={
                  (session.lastActiveAt ?? session.startedAt)
                    ? relative(new Date((session.lastActiveAt ?? session.startedAt)!))
                    : undefined
                }
                onSelect={() => onTab('sessions')}
              />
            ))}
          </List>
        </section>
      )}

      <div className="ds-agent-overview-links">
        <Button onClick={onSettings}>{t('allSettings')}</Button>
        <Button variant="ghost" onClick={() => onTab('runs')}>
          {t('allRuns')}
        </Button>
        {agent.runtimeState.capabilities.includes('sessions') && (
          <Button variant="ghost" onClick={() => onTab('sessions')}>
            {t('allSessions')}
          </Button>
        )}
      </div>
    </div>
  );
}
