'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import IssueDetail from '@/features/issue/components/detail/IssueDetail';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { useCycleOptionsQuery } from '@/services/cycles.service';
import { useBoardIssuesQuery, useProjectQuery } from '@/services/projects.service';
import { useViewFoldersQuery } from '@/services/views.service';
import { issuePath } from '@/utils/paths';

// A task of any project as the usual issue side panel over the current page (composed
// like the Shell's project, hooks/useShellProject): from the org chart's task ring, and
// from a link into another project (ProjectLinkSheet). The page behind stays as it is;
// only "open as page" navigates. A link names the task by its number (`sequenceNumber`);
// when that task is not on the project's board, `onMissing` is called.
export default function OrganizationTaskSheet({
  projectKey,
  issueId: givenId,
  sequenceNumber,
  onClose,
  onMissing,
}: {
  projectKey: string;
  issueId?: number;
  sequenceNumber?: number;
  onClose: () => void;
  onMissing?: () => void;
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
  const issueId =
    givenId ?? issues?.issues.find((issue) => issue.sequenceNumber === sequenceNumber)?.id ?? null;
  const missing = givenId == null && issues != null && issueId == null;
  useEffect(() => {
    if (missing) onMissing?.();
  }, [missing, onMissing]);
  if (!project || issueId == null) return null;
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
