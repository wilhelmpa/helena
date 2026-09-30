'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Filter, KeyRound, ListChecks, Route, ScrollText, Split, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import SectionPageView from '@/components/common/page/SectionPageView';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import {
  PageSelect,
  PageTabs,
  PageToolbar,
  PageToolbarSpacer,
} from '@/components/layout/PageToolbar';
import { Button } from '@/components/ui/button';
import { useTeamsQuery } from '@/services/teams.service';
import { accessPath } from '@/utils/paths';
import { DecisionClassCard } from './components/DecisionClassCard';
import { DecisionLog } from './components/DecisionLog';
import { RouterPanel } from './components/RouterPanel';
import { useDecisionClassesQuery } from '@/services/decisions.service';
import { classKey } from './utils/format';
import { FirstStagePanel } from './components/FirstStagePanel';
import { Card, Sections, Stack } from '@/design-system';

export type DecisionsTab = 'classes' | 'router' | 'log';

const STATUSES = ['decided', 'unsure', 'timeout', 'error', 'no_backend'] as const;

// Home → Entscheidungen (docs/helena-decisions/decisions.md): the typed decisions
// Helena asks — which model answers each kind, with which threshold, whether it passed its
// eval and is on —, the model router's switches, and the log of every decision.
export function DecisionsContent({ tab: initial = 'classes' }: { tab?: DecisionsTab }) {
  const t = useTranslations('decisions');
  const teams = useTeamsQuery();
  const teamList = teams.data ?? [];
  const [chosenTeam, setChosenTeam] = useState<string | null>(null);
  const teamId = chosenTeam ? Number(chosenTeam) : (teamList[0]?.id ?? null);
  const [tab, setTab] = useState<DecisionsTab>(initial);
  const [logClass, setLogClass] = useState('all');
  const [logStatus, setLogStatus] = useState('all');
  const classes = useDecisionClassesQuery(teamId);
  const data = classes.data;

  return (
    <>
      <PageToolbar>
        <PageTabs<DecisionsTab>
          label={t('tabs.label')}
          value={tab}
          onChange={setTab}
          items={[
            { value: 'classes', label: t('tabs.classes'), icon: ListChecks },
            { value: 'router', label: t('tabs.router'), icon: Route },
            { value: 'log', label: t('tabs.log'), icon: ScrollText },
          ]}
        />
        <PageToolbarSpacer />
        {teamList.length > 1 && (
          <PageSelect
            label={t('team')}
            icon={Users}
            value={String(teamId ?? '')}
            onChange={setChosenTeam}
            options={teamList.map((team) => ({ value: String(team.id), label: team.name }))}
          />
        )}
        {tab === 'log' && data && (
          <>
            <PageSelect
              label={t('log.class')}
              icon={Split}
              value={logClass}
              defaultValue="all"
              onChange={setLogClass}
              options={[
                { value: 'all', label: t('log.allClasses') },
                ...data.classes.map((cls) => ({
                  value: cls.id,
                  label: t(`classes.${classKey(cls.id)}.label` as never),
                })),
              ]}
            />
            <PageSelect
              label={t('log.statusFilter')}
              icon={Filter}
              value={logStatus}
              defaultValue="all"
              onChange={setLogStatus}
              options={[
                { value: 'all', label: t('log.allStatuses') },
                ...STATUSES.map((status) => ({ value: status, label: t(`log.status.${status}`) })),
              ]}
            />
          </>
        )}
      </PageToolbar>
      <SectionPageView title={t('title')} wide={tab === 'log'}>
        {teams.isPending || (teamId !== null && classes.isPending) ? (
          <ListSkeleton rows={4} rowClassName="h-24" />
        ) : teamId === null || !data ? (
          <EmptyState title={t('noTeam')} description={t('noTeamHint')} />
        ) : tab === 'router' ? (
          <RouterPanel teamId={teamId} />
        ) : tab === 'log' ? (
          <DecisionLog
            teamId={teamId}
            classId={logClass === 'all' ? '' : logClass}
            status={logStatus === 'all' ? '' : logStatus}
          />
        ) : (
          <Stack gap={4}>
            {data.connections.length === 0 && (
              <Card layout="row" pad="tight" className="flex-wrap items-center justify-between">
                <p className="text-sm text-muted-foreground">{t('noConnections')}</p>
                <Button asChild variant="outline" size="sm">
                  <Link href={accessPath('credentials')}>
                    <KeyRound />
                    {t('toAccess')}
                  </Link>
                </Button>
              </Card>
            )}
            <Sections>
              {data.firstStage && (
                <FirstStagePanel
                  teamId={teamId}
                  policy={data.firstStage}
                  classes={data.classes}
                  connections={data.connections}
                />
              )}
              {data.classes
                .filter((cls) => cls.id !== 'helena.browser')
                .map((cls) => (
                  <DecisionClassCard
                    key={cls.id}
                    teamId={teamId}
                    cls={cls}
                    connections={data.connections}
                  />
                ))}
            </Sections>
          </Stack>
        )}
      </SectionPageView>
    </>
  );
}

// The old /decisions page: the same content, now at home in the settings modal
// (Helena › Entscheider); the route opens the modal there.
export default function DecisionsPage({ tab }: { tab?: DecisionsTab }) {
  const tNav = useTranslations('nav');
  return (
    <Shell globalHome globalTitle={tNav('decisions')} autoOpenGlobalChat={false}>
      <DecisionsContent tab={tab} />
    </Shell>
  );
}
