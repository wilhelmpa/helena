import { useRef, useState, type CSSProperties } from 'react';
import { Maximize2, X } from 'lucide-react';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { IssueDetail as IssueDetailRow } from '@/lib/api/endpoints/issues';
import IssueDetailContent from './IssueDetailContent';
import IssueActionsBar from '../actions/IssueActionsBar';
import { useExitOnEscape } from '@/hooks/useExitOnEscape';
import { useExitOnClickOutside } from '../../hooks/useExitOnClickOutside';
import { SidePanelResizeHandle, useSidePanelWidth } from '@/design-system';
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
  const tCommon = useTranslations('common');
  const [issue, setIssue] = useState<IssueDetailRow | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  useExitOnEscape(onClose);
  useExitOnClickOutside(panelRef, onClose);

  const { width } = useSidePanelWidth();
  const title = issue ? `${issue.identifier} · ${issue.title}` : '';

  // The task in the one overlay on the right (docs/design-system.md §9): the same width,
  // handle, spacing and head as the tool panel — a segment tab naming the task, its
  // actions, full screen (the two-column page) and close.
  return (
    <aside
      ref={panelRef}
      aria-label={title || t('openAsPage')}
      className="ds-side-panel ds-issue-overlay"
      data-open="true"
      data-full="false"
      style={{ '--ds-panel-w': `${width}px` } as CSSProperties}
    >
      <SidePanelResizeHandle />
      <div className="ds-panel-head">
        <div className="ds-panel-tabs">
          <div className="ds-panel-tabs-track">
            <div className="ds-panel-tab">
              <span className="ds-panel-tab-select" role="tab" aria-selected="true">
                <span>{title}</span>
              </span>
            </div>
          </div>
        </div>
        <div className="ds-panel-head-tools">
          {issue && (
            <IssueActionsBar project={project} issue={issue} variant="header" onDeleted={onClose} />
          )}
          <button
            type="button"
            className="ds-icon-button"
            onClick={() => onExpand(issue?.sequenceNumber ?? null)}
            title={t('openAsPage')}
            aria-label={t('openAsPage')}
          >
            <Maximize2 size={15} />
          </button>
          <button
            type="button"
            className="ds-icon-button"
            onClick={onClose}
            title={tCommon('close')}
            aria-label={tCommon('close')}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="ds-issue-overlay-body">
        <IssueDetailContent
          project={project}
          issueId={issueId}
          onIssueLoaded={setIssue}
          onDeleted={onClose}
        />
      </div>
    </aside>
  );
}
