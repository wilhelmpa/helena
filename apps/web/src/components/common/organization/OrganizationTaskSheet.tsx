'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import IssueDetail from '@/features/issue/components/detail/IssueDetail';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { useCycleOptionsQuery } from '@/services/cycles.service';
import { useBoardIssuesQuery, useProjectQuery } from '@/services/projects.service';
import { useViewFoldersQuery } from '@/services/views.service';
import { issuePath } from '@/utils/paths';

// A task from the org chart's task ring, as the usual issue side panel on top of the
// chart (composed like the Shell's project, hooks/useShellProject). The chart behind it
// stays as it is; only "open as page" navigates.
export default function OrganizationTaskSheet({
  projectKey,
  issueId,
  onClose,
}: {
  projectKey: string;
  issueId: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const scaffold = useProjectQuery(projectKey).data ?? null;
  const issues = useBoardIssuesQuery(projectKey).data;
  const cycles = useCycleOptionsQuery(scaffold?.project.cyclesEnabled ? projectKey : null).data;
  const areas = useViewFoldersQuery(projectKey).data;
  const project = useMemo<ProjectDetail | null>(
    () =>
      scaffold
        ? {
            ...scaffold,
            issues: issues?.issues ?? [],
            plannedCycles: cycles ?? [],
            areas: areas ?? [],
          }
        : null,
    [scaffold, issues, cycles, areas],
  );
  if (!project) return null;
  return (
    <IssueDetail
      project={project}
      issueId={issueId}
      onClose={onClose}
      onExpand={(sequenceNumber) => {
        if (sequenceNumber != null) router.push(issuePath(projectKey, sequenceNumber));
        onClose();
      }}
    />
  );
}
