import { useState } from 'react';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { IssueDetail as IssueDetailRow } from '@/lib/api/endpoints/issues';
import IssueDetailContent from './IssueDetailContent';
import IssueActionsBar from '../actions/IssueActionsBar';
import { Overlay } from '@/design-system';
import { useTranslations } from 'next-intl';

// The issue detail as a side panel over the project, at the end edge. Expand opens the
// same issue as a full page; the shared body lives in IssueDetailContent.
export default function IssueDetail({
  project,
  issueId,
  onClose,
  onExpand,
}: {
  project: ProjectDetail;
  issueId: number;
  onClose: () => void;
  // Passed the issue's project-scoped number so the host can open the page URL
  // (/project/KEY/issue/42); null while the issue is still loading.
  onExpand: (sequenceNumber: number | null) => void;
}) {
  const t = useTranslations('issue');
  const [issue, setIssue] = useState<IssueDetailRow | null>(null);
  // The tab names the task by its number; its title is the heading of the body (editable).
  const title = issue?.identifier ?? '';

  // The task in the one overlay on the right (docs/design-system.md §9): a tab naming the
  // task, its actions as one "..." menu, its page (two columns), pin, full screen and close.
  // A click on the page behind does not close it: it holds what is being written.
  return (
    <Overlay
      label={title || t('openAsPage')}
      tabs={[{ id: 'task', label: title }]}
      actions={
        issue && (
          <IssueActionsBar project={project} issue={issue} variant="header" onDeleted={onClose} />
        )
      }
      onClose={onClose}
      pin={{ kind: 'issue', value: `${project.project.key}:${issueId}` }}
      onOpenPage={() => onExpand(issue?.sequenceNumber ?? null)}
      className="ds-issue-overlay"
      bodyClassName="ds-issue-overlay-body"
    >
      <IssueDetailContent
        project={project}
        issueId={issueId}
        onIssueLoaded={setIssue}
        onDeleted={onClose}
      />
    </Overlay>
  );
}
