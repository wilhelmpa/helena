'use client';

import { Activity, Brush } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { formatDurationShort } from '@/utils/dates';
import { SectionLabel } from '@/components/common/page/RowList';
import { useSystemHealthQuery } from '../../services/systemHealth.service';
import { healthProblems } from '../../utils/systemHealth';
import HomeAgentSync from './HomeAgentSync';
import HomeEngineState from './HomeEngineState';
import HomeJanitorState from './HomeJanitorState';
import HomeServiceState from './HomeServiceState';

// The instance owner's view of the services around Helena — the Hermes runner, the
// Helena engine (workflows, agent teams, routines), the provisioning service and the
// worker — the runs that wait, stall or overran, what the engine is doing, and the
// janitor loops that clean up hung runs. A status report of 32px lines in the sidebar's
// surface, without hover: nothing here is a control, so nothing here looks like one. No
// secret or path ever appears, only counts, times and short reasons.
export default function HomeSystemHealth() {
  const t = useTranslations('god.systemHealth');
  const { data: session } = useSession();
  // Read after mount, so the server render and the first client render agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isGod = mounted && session?.user.role === 'god';
  const { data } = useSystemHealthQuery(isGod);
  if (!isGod || !data) return null;

  const problems = healthProblems(data.runs, data.engine).map((problem) =>
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
        <ul className="grid grid-cols-1 rounded-lg border bg-card p-1 sm:grid-cols-2">
          {data.services.map((health) => (
            <HomeServiceState key={health.service} health={health} />
          ))}
        </ul>
        <HomeEngineState engine={data.engine} />
        {problems.length > 0 && (
          <ul className="mt-1 space-y-0.5 px-2 text-xs text-status-waiting">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {data.agents && (
          <div className="mt-2">
            <HomeAgentSync summary={data.agents} />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <SectionLabel icon={<Brush />}>{t('janitorsTitle')}</SectionLabel>
        <ul className="grid grid-cols-1 rounded-lg border bg-card p-1">
          {data.janitors.map((health) => (
            <HomeJanitorState key={health.job} health={health} />
          ))}
        </ul>
      </div>
    </section>
  );
}
