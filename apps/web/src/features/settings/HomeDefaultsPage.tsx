'use client';

import { useQueries } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import { useProjectsQuery } from '@/services/projects.service';
import { useCurrentTeam } from '@/components/common/page/useTeamSections';
import { getBrowserControl } from '@/lib/api/endpoints/browserTask';
import { InstanceBrowserControlSection } from '@/features/browser-lab/components/InstanceBrowserControlSection';

// The browser default for all projects; the other project defaults (autopilot, MCP, run
// resume, engine) follow on the same page from GodGeneralPage, once.
export default function HomeDefaultsPage() {
  const t = useTranslations('settings.defaults');
  const { data: session } = useSession();
  const team = useCurrentTeam();
  if (session?.user.role !== 'god') {
    return <p className="text-sm text-muted-foreground">{t('adminOnly')}</p>;
  }
  return <AdminHomeDefaults teamId={team?.id ?? null} />;
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

  return (
    <div className="space-y-6">
      <InstanceBrowserControlSection overrideCount={overrideCount} />
    </div>
  );
}
