'use client';

import { useTranslations } from 'next-intl';
import { FolderKanban } from 'lucide-react';
import { RowEmpty } from '@/components/common/page/RowList';
import { useProjectsQuery } from '@/services/projects.service';
import { DashboardSection, SkeletonRows } from '../DashboardParts';
import HomeProjectCard from '../../components/home/HomeProjectCard';

// "Projekte": every project the reader belongs to as a tile that opens its board (name and
// key, the team, whether setting it up worked, the description).
export default function ProjectsSection() {
  const t = useTranslations('home');
  const projects = useProjectsQuery();
  const list = projects.data ?? [];
  return (
    <DashboardSection label={t('widgets.projects')} count={list.length || null}>
      {projects.isPending ? (
        <SkeletonRows count={2} />
      ) : list.length === 0 ? (
        <RowEmpty icon={<FolderKanban />}>{t('projects.empty')}</RowEmpty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-1">
          {list.map((project) => (
            <HomeProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </DashboardSection>
  );
}
