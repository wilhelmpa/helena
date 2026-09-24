'use client';

import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { SectionLabel } from '@/components/common/page/RowList';
import { useProjectsQuery } from '@/services/projects.service';
import HomeOpenTasks from './components/home/HomeOpenTasks';
import HomeProjectCard from './components/home/HomeProjectCard';
import HomeSystemHealth from './components/home/HomeSystemHealth';
import HomeKpiRow from './components/home/HomeKpiRow';
import HomeNeedsYou from './components/home/HomeNeedsYou';
import HomeAgentsNow from './components/home/HomeAgentsNow';
import { useToday } from './hooks/useToday';

// Start (docs/volition-design-helena-ui.md "Start"): the greeting with today's date,
// three figures, "Braucht dich" beside "Agenten gerade", the reader's own open tasks,
// the projects, and for the owner the health of the services. The page's one title is
// the greeting (16px); every group is a sidebar-surface box of 32px rows, and every row
// that looks clickable opens something. One column on a phone.
export default function HomePage() {
  const t = useTranslations('nav');
  const projects = useProjectsQuery();
  const today = useToday();
  return (
    <Shell globalHome>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 p-4">
          <header className="flex flex-col gap-3">
            <div className="px-1">
              <h1 className="text-base font-semibold">{t('homeGreeting')}</h1>
              <p className="h-4 text-xs text-muted-foreground">{today}</p>
            </div>
            <HomeKpiRow />
          </header>

          <div className="grid grid-cols-1 gap-x-4 gap-y-5 lg:grid-cols-2">
            <HomeNeedsYou />
            <HomeAgentsNow />
          </div>

          <HomeOpenTasks />

          {(projects.data?.length ?? 0) > 0 && (
            <section className="min-w-0">
              <SectionLabel>{t('projects')}</SectionLabel>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2">
                {projects.data?.map((project) => (
                  <HomeProjectCard key={project.id} project={project} />
                ))}
              </div>
            </section>
          )}

          <HomeSystemHealth />
        </div>
      </div>
    </Shell>
  );
}
