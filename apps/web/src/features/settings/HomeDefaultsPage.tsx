'use client';

import { useQueries } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { useProjectsQuery } from '@/services/projects.service';
import { useCurrentTeam } from '@/components/common/page/useTeamSections';
import { getBrowserControl } from '@/lib/api/endpoints/browserTask';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { InstanceBrowserControlSection } from '@/features/browser-lab/components/InstanceBrowserControlSection';
import GodProjectDefaultsSettings from '@/features/god/components/GodProjectDefaultsSettings';
import { useInstanceProjectDefaultsQuery } from '@/features/god/services/god.service';

export default function HomeDefaultsPage() {
  const { data: session } = useSession();
  const team = useCurrentTeam();
  if (session?.user.role !== 'god') {
    return (
      <p className="text-sm text-muted-foreground">
        {'Die vorhandenen instanzweiten Vorgaben können nur Administratoren ändern.'}
      </p>
    );
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
  const defaults = useInstanceProjectDefaultsQuery();
  const overrideCount = controls.filter(
    (query) => query.data?.setting.mode !== 'inherit' && query.data,
  ).length;

  return (
    <div className="space-y-6">
      <InstanceBrowserControlSection overrideCount={overrideCount} />
      {defaults.data ? (
        <div>
          <GodProjectDefaultsSettings defaults={defaults.data} />
          <p className="mt-2 text-xs text-muted-foreground">
            {
              'Autopilot und MCP werden beim Anlegen eines Projekts übernommen; bestehende Projekte erben spätere Änderungen nicht.'
            }
          </p>
        </div>
      ) : (
        <ListSkeleton rows={2} rowClassName="h-12" />
      )}
    </div>
  );
}
