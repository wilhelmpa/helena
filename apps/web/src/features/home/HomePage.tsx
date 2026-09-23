'use client';

import { MessageSquareText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { useProjectsQuery } from '@/services/projects.service';
import HomeOpenTasks from './components/home/HomeOpenTasks';
import HomeProjectCard from './components/home/HomeProjectCard';

export default function HomePage() {
  const t = useTranslations('nav');
  const projects = useProjectsQuery();
  return (
    <Shell globalHome>
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-start gap-3">
            <MessageSquareText className="mt-0.5 size-8 shrink-0 text-muted-foreground" />
            <div>
              <h1 className="text-xl font-semibold">{t('home')}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t('globalHomeHint')}</p>
            </div>
          </div>
          <HomeOpenTasks />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-3">
            {projects.data?.map((project) => (
              <HomeProjectCard key={project.id} project={project} />
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
