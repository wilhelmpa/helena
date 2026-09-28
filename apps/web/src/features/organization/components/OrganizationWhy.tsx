'use client';

import { useTranslations } from 'next-intl';
import { EmptyState, List, ListRow } from '@/design-system';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { useProjectWhyChains } from '@/services/projectGoals.service';
import { issueIdentifierPath } from '@/utils/paths';

// Team → "Warum" (hub/pc-goal-ladder): for every task an agent of the project works on,
// the chain from the agent through the task up its goal ladder — who works on what, and
// what for.
export default function OrganizationWhy({ projectKey }: { projectKey: string }) {
  const t = useTranslations('organization.chart');
  const chains = useProjectWhyChains(projectKey);
  if (chains.isPending) return <ListSkeleton rows={5} rowClassName="h-10" />;
  const rows = chains.data ?? [];
  if (rows.length === 0) return <EmptyState>{t('whyEmpty')}</EmptyState>;
  return (
    <List>
      {rows.map(({ why, agent }) => {
        const ladder = [
          ...(why.goal ? [...why.goal.path, why.goal.title] : []),
          ...(why.initiative ? [why.initiative.title] : []),
        ];
        return (
          <ListRow
            key={why.task.id}
            href={issueIdentifierPath(why.task.identifier)}
            title={
              <>
                <span className="ds-issue-key">{why.task.identifier}</span> {why.task.title}
              </>
            }
            subtitle={ladder.length ? ladder.join(' › ') : t('whyNoGoal')}
            meta={agent?.name ?? t('noAgent')}
          />
        );
      })}
    </List>
  );
}
