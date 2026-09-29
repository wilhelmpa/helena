'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import IssueDetail from '@/features/issue/components/detail/IssueDetail';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { useCycleOptionsQuery } from '@/services/cycles.service';
import { useBoardIssuesQuery, useProjectQuery } from '@/services/projects.service';
import { useViewFoldersQuery } from '@/services/views.service';
import { useIssueBySeqQuery } from '@/services/issues.service';
import { issuePath } from '@/utils/paths';

// A task of any project as the usual issue side panel over the current page (composed
// like the Shell's project, hooks/useShellProject): from the org chart's task ring, and
// from a link into another project (ProjectLinkSheet). The page behind stays as it is;
// only "open as page" navigates. A link names the task by its number (`sequenceNumber`);
// when that task is not on the project's board it is read by its number, and only when it
// cannot be read at all (gone, no access) `onMissing` is called.
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
  const scaffoldQuery = useProjectQuery(projectKey);
  const scaffold = scaffoldQuery.data ?? null;
  const boardQuery = useBoardIssuesQuery(projectKey);
  const issues = boardQuery.data;
  const boardDone = issues != null || boardQuery.isError;
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
  const onBoard = issues?.issues.find((issue) => issue.sequenceNumber === sequenceNumber)?.id;
  // A task the board does not carry (done, archived, a filtered board) is read by its
  // number: a mention in the inbox, a dashboard or activity link, a link in a chat opens
  // the task here, in the panel, with all its actions, not a sheet that only offers to
  // switch the project (owner, 29.09.).
  const bySeq = useIssueBySeqQuery(
    givenId == null && boardDone && onBoard == null ? projectKey : null,
    sequenceNumber ?? null,
  );
  const issueId = givenId ?? onBoard ?? bySeq.data?.id ?? null;
  const missing =
    scaffoldQuery.isError || (givenId == null && boardDone && onBoard == null && bySeq.isError);
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
