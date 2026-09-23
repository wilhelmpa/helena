'use client';

import { Activity, Brush } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { formatDurationShort } from '@/utils/dates';
import { SectionLabel } from '@/components/common/page/RowList';
import { useSystemHealthQuery } from '../../services/systemHealth.service';
import { healthProblems } from '../../utils/systemHealth';
import HomeJanitorState from './HomeJanitorState';
import HomeServiceState from './HomeServiceState';

// The instance owner's view of the services around Helena — the Hermes runner, Mastra,
// the bridge between them, the provisioning service and the worker — the agent runs
// that wait or overran, and the janitor loops that clean up hung runs, orphaned stage
// runs and stale workflow schedules. A status report in two columns of 32px lines, not
// a grid of cards: nothing here is a control, so nothing here looks like one. No secret
// or path ever appears, only counts, times and short reasons.
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
    <section className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
      <div className="min-w-0">
        <SectionLabel icon={<Activity />}>{t('title')}</SectionLabel>
        <ul className="grid grid-cols-1 border-t border-sidebar-border pt-1 sm:grid-cols-2 lg:grid-cols-1">
          {data.services.map((health) => (
            <HomeServiceState key={health.service} health={health} />
          ))}
        </ul>
        {problems.length > 0 && (
          <ul className="mt-1 space-y-0.5 px-2 text-xs text-status-waiting">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0">
        <SectionLabel icon={<Brush />}>{t('janitorsTitle')}</SectionLabel>
        <ul className="grid grid-cols-1 border-t border-sidebar-border pt-1">
          {data.janitors.map((health) => (
            <HomeJanitorState key={health.job} health={health} />
          ))}
        </ul>
      </div>
    </section>
  );
}
