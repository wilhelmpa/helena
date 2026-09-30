'use client';

import { Sections } from '@/design-system';
import { useLocale, useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Switch } from '@/components/ui/switch';
import {
  useRouterOverviewQuery,
  useSetAgentRouter,
  useSetProjectRouter,
} from '@/services/decisions.service';
import { percent } from '../utils/format';
import { useRouteReason } from './ModelRouteLine';

// The model router's switches (Einstellungen → Entscheidungen → Modellwahl): per agent whether
// its runs and chat answers may go to a cheaper model of its runtime (off by default) and
// whether a stronger one is allowed; per project whether the router may act there (on by
// default); and its last decisions.
export function RouterPanel({ teamId }: { teamId: number }) {
  const t = useTranslations('decisions.router');
  const locale = useLocale();
  const overview = useRouterOverviewQuery(teamId);
  const setAgent = useSetAgentRouter(teamId);
  const setProject = useSetProjectRouter(teamId);
  const reason = useRouteReason();
  if (overview.isPending) return <ListSkeleton rows={3} rowClassName="h-12" />;
  const data = overview.data;
  if (!data) return null;
  const names = new Map(data.agents.map((agent) => [agent.id, agent.name]));

  return (
    <Sections>
      <SettingsSection title={t('agents')} description={t('agentsHint')}>
        <SettingsCard className="divide-y divide-border/60">
          {data.agents.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t('noAgents')}</p>
          ) : (
            data.agents.map((agent) => (
              <div
                key={agent.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{agent.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {agent.model ?? t('defaultModel')}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    {t('allowUpgrade')}
                    <Switch
                      checked={agent.allowUpgrade}
                      disabled={!agent.enabled}
                      onCheckedChange={(allowUpgrade) =>
                        setAgent.mutate({ agentId: agent.id, allowUpgrade })
                      }
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    {t('enabled')}
                    <Switch
                      checked={agent.enabled}
                      onCheckedChange={(enabled) => setAgent.mutate({ agentId: agent.id, enabled })}
                    />
                  </label>
                </div>
              </div>
            ))
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('projects')} description={t('projectsHint')}>
        <SettingsCard className="divide-y divide-border/60">
          {data.projects.map((project) => (
            <SettingsRow
              key={project.id}
              title={project.name}
              description={project.key}
              control={
                <Switch
                  checked={project.enabled}
                  onCheckedChange={(enabled) =>
                    setProject.mutate({ projectId: project.id, enabled })
                  }
                />
              }
            />
          ))}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('recent')} description={t('recentHint')}>
        {data.recent.length === 0 ? (
          <EmptyState title={t('noRoutes')} description={t('noRoutesHint')} />
        ) : (
          <SettingsCard className="divide-y divide-border/60">
            {data.recent.map((route) => (
              <div
                key={route.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  {names.get(route.agentId) ?? `#${route.agentId}`} ·{' '}
                  {route.runId ? t('run', { id: route.runId }) : t('chat')} ·{' '}
                  {route.routed ? (
                    <span>
                      {route.fromModel} → <span className="font-medium">{route.toModel}</span>
                    </span>
                  ) : (
                    route.fromModel
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {reason(route.reason)}
                  {route.confidence !== null ? ` · ${percent(route.confidence)}` : ''} ·{' '}
                  {new Date(route.createdAt).toLocaleString(locale)}
                </span>
              </div>
            ))}
          </SettingsCard>
        )}
      </SettingsSection>
    </Sections>
  );
}
