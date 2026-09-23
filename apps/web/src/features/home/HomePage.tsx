'use client';

import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
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
// (HomeOpenTasks — this is the "Mein Tagesplan" the doc asks for), the system
// health strip, then the projects.
export default function HomePage() {
  const t = useTranslations('nav');
  const projects = useProjectsQuery();
  return (
    <Shell globalHome>
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-1">
            <h1 className="text-2xl font-semibold tracking-tight">{t('homeGreeting')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatLongDate(new Date().toISOString())} · {t('globalHomeHint')}
            </p>
          </div>

          <HomeKpiRow />

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <HomeNeedsYou />
            <HomeAgentsNow />
          </div>

          <HomeOpenTasks />
          <HomeSystemHealth />
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
