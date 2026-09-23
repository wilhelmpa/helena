'use client';

import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { SectionLabel } from '@/components/common/page/RowList';
import { useProjectsQuery } from '@/services/projects.service';
import { formatLongDate } from '@/utils/dates';
import HomeOpenTasks from './components/home/HomeOpenTasks';
import HomeProjectCard from './components/home/HomeProjectCard';
import HomeSystemHealth from './components/home/HomeSystemHealth';
import HomeKpiRow from './components/home/HomeKpiRow';
import HomeNeedsYou from './components/home/HomeNeedsYou';
import HomeAgentsNow from './components/home/HomeAgentsNow';

// Home (docs/volition-design-helena-ui.md "Start"): a greeting with the date, the
// KPI row, "Braucht dich" beside "Agenten gerade", the reader's own open tasks
// (HomeOpenTasks — this is the "Mein Tagesplan" the doc asks for), the projects, and
// for the owner the system health. One column on a phone; every list in the sidebar's
// row style, every row that looks clickable opens something.
export default function HomePage() {
  const t = useTranslations('nav');
  const projects = useProjectsQuery();
  return (
    <Shell globalHome>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-5 lg:px-6">
          <header className="flex flex-col gap-2">
            <div>
              <h1 className="text-2xl font-semibold">{t('homeGreeting')}</h1>
              <p className="mt-0.5 text-caption text-muted-foreground">
                {formatLongDate(new Date().toISOString())} · {t('globalHomeHint')}
              </p>
            </div>
            <HomeKpiRow />
          </header>

          <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
            <HomeNeedsYou />
            <HomeAgentsNow />
          </div>

          <HomeOpenTasks />

          {(projects.data?.length ?? 0) > 0 && (
            <section className="min-w-0">
              <SectionLabel>{t('projects')}</SectionLabel>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-2">
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
