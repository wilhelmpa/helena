'use client';

import { Activity, Brush } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { formatDurationShort } from '@/utils/dates';
import { useSystemHealthQuery } from '../../services/systemHealth.service';
import { healthProblems } from '../../utils/systemHealth';
import HomeJanitorState from './HomeJanitorState';
import HomeServiceState from './HomeServiceState';

// The instance owner's view of the services around Plan — the Hermes runner, Mastra, the
// bridge between them, the provisioning service and the worker — the agent runs that
// wait or overran, and the janitor loops that clean up hung runs, orphaned stage runs
// and stale workflow schedules. Only what needs attention is listed under the services;
// no secret or path ever appears here, only counts, times and short reasons.
export default function HomeSystemHealth() {
  const t = useTranslations('god.systemHealth');
  const { data: session } = useSession();
  // Read after mount, so the server render and the first client render agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isGod = mounted && session?.user.role === 'god';
  const { data } = useSystemHealthQuery(isGod);
  if (!isGod || !data) return null;

  const problems = healthProblems(data.runs).map((problem) =>
    problem.key === 'waiting'
      ? t('waiting', {
          count: problem.count,
          time: problem.since ? formatDurationShort(problem.since) : '',
        })
      : t(problem.key, { count: problem.count }),
  );

  return (
    <section className="mb-6 space-y-4">
      <div>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Activity className="size-4 text-muted-foreground" />
          {t('title')}
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-2">
          {data.services.map((health) => (
            <HomeServiceState key={health.service} health={health} />
          ))}
        </ul>
        {problems.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Brush className="size-4 text-muted-foreground" />
          {t('janitorsTitle')}
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2">
          {data.janitors.map((health) => (
            <HomeJanitorState key={health.job} health={health} />
          ))}
        </ul>
      </div>
    </section>
  );
}
