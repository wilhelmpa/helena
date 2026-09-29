'use client';

import { useQueries } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import { useProjectsQuery } from '@/services/projects.service';
import { useCurrentTeam } from '@/components/common/page/useTeamSections';
import { getBrowserControl } from '@/lib/api/endpoints/browserTask';
import { InstanceBrowserControlSection } from '@/features/browser-lab/components/InstanceBrowserControlSection';
import { EmptyState, Page, Stack } from '@/design-system';
import { Lock } from 'lucide-react';
import { useInstanceProjectDefaultsQuery } from '@/features/god/services/god.service';
import StandingOrdersGroup from '@/features/autopilot/components/StandingOrdersGroup';
import DefaultBudgetsGroup from './components/DefaultBudgetsGroup';

// Vorgaben für Projekte: the budgets every new project starts with, Helena's standing
// orders and the browser default for all projects; the other project defaults (autopilot,
// MCP, run resume, engine) follow on the same page from GodGeneralPage, once.
export default function HomeDefaultsPage() {
  const t = useTranslations('settings.defaults');
  const { data: session } = useSession();
  const team = useCurrentTeam();
  if (session?.user.role !== 'god') {
    return (
      <Page>
        <EmptyState icon={<Lock />}>{t('adminOnly')}</EmptyState>
      </Page>
    );
  }
  return (
    <Page>
      <AdminHomeDefaults teamId={team?.id ?? null} />
    </Page>
  );
}

function AdminHomeDefaults({ teamId }: { teamId: number | null }) {
  const projects = useProjectsQuery().data?.filter((project) => project.teamId === teamId) ?? [];
  const controls = useQueries({
    queries: projects.map((project) => ({
      queryKey: ['browser-control', project.key],
      queryFn: () => getBrowserControl(project.key),
      staleTime: 60_000,
    })),
  });
  const overrideCount = controls.filter(
    (query) => query.data?.setting.mode !== 'inherit' && query.data,
  ).length;
  const t = useTranslations('settings.defaults');
  const defaults = useInstanceProjectDefaultsQuery(true);

  return (
    <Stack gap={5}>
      {defaults.data && (
        <DefaultBudgetsGroup key={JSON.stringify(defaults.data.budgets)} defaults={defaults.data} />
      )}
      <StandingOrdersGroup
        scope={null}
        title={t('helenaOrdersTitle')}
        description={t('helenaOrdersHint')}
        canEdit
      />
      <InstanceBrowserControlSection overrideCount={overrideCount} />
    </Stack>
  );
}
