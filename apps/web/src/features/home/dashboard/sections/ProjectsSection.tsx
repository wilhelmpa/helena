'use client';

import { useTranslations } from 'next-intl';
import { FolderKanban } from 'lucide-react';
import { RowEmpty } from '@/components/common/page/RowList';
import { useProjectsQuery } from '@/services/projects.service';
import { Grid } from '@/design-system';
import { DashboardSection, SkeletonRows } from '../DashboardParts';
import HomeProjectCard from '../../components/home/HomeProjectCard';
import { useBudgetOverview } from '../useBudgetOverview';
import { useAgentsNow } from './AgentsSection';

// "Projekte": every project the reader belongs to as a tile in its colour that opens its
// board, with its open tasks, the agents working in it and its budget (owner, O7).
export default function ProjectsSection() {
  const t = useTranslations('home');
  const projects = useProjectsQuery();
  const list = (projects.data ?? []).filter((project) => project.projectRole !== 'home');
  const budgets = useBudgetOverview(true);
  const { running } = useAgentsNow();
  const working = (key: string) =>
    new Set(running.filter((entry) => entry.project?.key === key).map((entry) => entry.agent?.id))
      .size;
  return (
    <DashboardSection label={t('widgets.projects')} count={list.length || null}>
      {projects.isPending ? (
        <SkeletonRows count={2} />
      ) : list.length === 0 ? (
        <RowEmpty icon={<FolderKanban />}>{t('projects.empty')}</RowEmpty>
      ) : (
        <Grid min="tile" gap={3}>
          {list.map((project) => (
            <HomeProjectCard
              key={project.id}
              project={project}
              budgets={budgets.byProject.get(project.key)}
              working={working(project.key)}
            />
          ))}
        </Grid>
      )}
    </DashboardSection>
  );
}
