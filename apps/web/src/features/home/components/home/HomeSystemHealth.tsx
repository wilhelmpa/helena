'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { formatDurationShort } from '@/utils/dates';
import { useSystemHealthQuery } from '../../services/systemHealth.service';
import { healthProblems } from '../../utils/systemHealth';
import HomeAgentSync from './HomeAgentSync';
import HomeEngineState from './HomeEngineState';
import HomeJanitorState from './HomeJanitorState';
import HomeLogins from './HomeLogins';
import HomeServiceState from './HomeServiceState';
import LimitsHealthLines from '@/features/provider-limits/components/LimitsHealthLines';
import ModelAvailabilityHealthLines from '@/features/model-availability/components/ModelAvailabilityHealthLines';
import ServerHealthLines from '@/features/server/components/ServerHealthLines';
import { Box, Card, Grid, Stack } from '@/design-system';

// The instance owner's view of the services around Helena (Start → System, in a dialog) — the Hermes runner, the
// Helena engine (workflows, agent teams, routines), the provisioning service and the
// worker — the runs that wait, stall or overran, what the engine is doing, the model logins
// agents share, and the janitor loops that clean up hung runs. A status report of 32px lines in the sidebar's
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
    // Two cards side by side (owner, O8: the system page was a list of text without cards):
    // the services with everything that depends on them, and the maintenance loops.
    <Grid columns={2} gap={4}>
      <Card title={t('title')}>
        <Stack gap={3}>
          <ul>
            {data.services.map((health) => (
              <HomeServiceState key={health.service} health={health} />
            ))}
          </ul>
          <HomeEngineState engine={data.engine} />
          {problems.length > 0 && (
            <Stack as="ul" gap={1} className="text-status-waiting">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </Stack>
          )}
          <ServerHealthLines />
          <LimitsHealthLines />
          <ModelAvailabilityHealthLines models={data.models} />
          <HomeLogins health={data.logins} />
          {data.agents && (
            <Box marginTop={2}>
              <HomeAgentSync summary={data.agents} />
            </Box>
          )}
        </Stack>
      </Card>
      <Card title={t('janitorsTitle')}>
        <ul>
          {data.janitors.map((health) => (
            <HomeJanitorState key={health.job} health={health} />
          ))}
        </ul>
      </Card>
    </Grid>
  );
}
