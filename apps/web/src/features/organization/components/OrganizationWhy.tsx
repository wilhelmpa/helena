'use client';

import { useTranslations } from 'next-intl';
import { EmptyState, List, ListGroup, ListRow } from '@/design-system';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { ProjectWhyChain } from '@/lib/api/endpoints/projectGoals';
import { useProjectsWhyChains } from '@/services/projectGoals.service';
import { issueIdentifierPath } from '@/utils/paths';

// Team → "Warum" (hub/pc-goal-ladder): for every task an agent works on, the chain from
// the agent through the task up its goal ladder — who works on what, and what for. On a
// project's Team page its own chains; on Helena's Team page every project's, a group each.
export default function OrganizationWhy({
  projects,
}: {
  projects: { key: string; name: string }[];
}) {
  const t = useTranslations('organization.chart');
  const queries = useProjectsWhyChains(projects.map((project) => project.key));
  if (queries.some((query) => query.isPending)) {
    return <ListSkeleton rows={5} rowClassName="h-10" />;
  }
  const groups = projects
    .map((project, index) => ({ project, rows: queries[index]?.data ?? [] }))
    .filter((group) => group.rows.length > 0);
  if (groups.length === 0) return <EmptyState>{t('whyEmpty')}</EmptyState>;
  if (projects.length === 1)
    return (
      <List>
        {groups[0]!.rows.map((row) => (
          <WhyRow key={row.why.task.id} row={row} />
        ))}
      </List>
    );
  return (
    <List>
      {groups.map(({ project, rows }) => (
        <ListGroup key={project.key} label={project.name} count={rows.length}>
          {rows.map((row) => (
            <WhyRow key={row.why.task.id} row={row} />
          ))}
        </ListGroup>
      ))}
    </List>
  );
}

function WhyRow({ row: { why, agent } }: { row: ProjectWhyChain }) {
  const t = useTranslations('organization.chart');
  const ladder = [
    ...(why.goal ? [...why.goal.path, why.goal.title] : []),
    ...(why.initiative ? [why.initiative.title] : []),
  ];
  return (
    <ListRow
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
}
