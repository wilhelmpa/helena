import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  Check,
  ClipboardCopy,
  GitBranch,
  Globe,
  Share2,
  Trash2,
} from 'lucide-react';
import type { ActionDef } from '@/lib/api/endpoints/actions';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { IssueDetail as IssueDetailRow } from '@/lib/api/endpoints/issues';
import { enableIssueShare, disableIssueShare } from '@/lib/api/endpoints/share';
import { actionIcon } from '@/utils/actionIcons';
import { useActionsQuery } from '@/services/actions.service';
import { useRestoreIssue } from '@/services/issues.service';
import { qk } from '@/services/queryKeys';
import { usePermissions } from '@/hooks/usePermissions';
import { useArchiveAction } from '../../hooks/useArchiveAction';
import { ApplyActionDialog, DeleteIssueDialog, matchedActions } from './IssueActions';
import { buildIssueBranchName, buildIssuePrompt } from '../../utils/issuePrompt';
import { useSession } from '@/lib/auth-client';
import { shareIssuePath } from '@/utils/paths';
import { ActionMenu, type ActionMenuItem } from '@/design-system';
import {
  PageActions,
  PageToolbar,
  PageToolbarSpacer,
  type PageAction,
} from '@/components/layout/PageToolbar';
import ShareDialog from '@/components/common/share/ShareDialog';
import { useTranslations } from 'next-intl';
import { copyText } from '@/utils/clipboard';

// The issue detail Actions: the manual actions whose condition matches this
// issue, plus Copy Prompt and a delete button. Owns the delete/apply
// confirmations and the mutations they run. The confirm dialogs render through a
// portal, so their position in the tree does not matter.
export default function IssueActionsBar({
  project,
  issue,
  variant = 'row',
  onDeleted,
}: {
  project: ProjectDetail;
  issue: IssueDetailRow;
  // 'row' wraps the "..." menu in a right-aligned row of its own. 'header' renders it bare,
  // for the overlay's head. 'toolbar' puts the actions into the page's header bar
  // (PageToolbar) — the full-page issue view.
  variant?: 'row' | 'header' | 'toolbar';
  onDeleted?: () => void;
}) {
  const t = useTranslations('issue.actionsBar');
  const tCommands = useTranslations('issue.commands');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();
  const { data: session } = useSession();
  const qc = useQueryClient();
  const canEdit = can('work_items', 'edit');
  const canDelete = can('work_items', 'delete');
  const actionsQuery = useActionsQuery(project.project.key);
  const { archive, dialog: archiveDialog } = useArchiveAction(project);
  const restoreIssue = useRestoreIssue(project.project.key);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState<ActionDef | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Enabling/revoking the public link refetches the issue so its shareToken and
  // shareExtended (which the dialog reads) stay in sync. The same call creates the
  // link and flips how much a live one exposes.
  async function share(extended: boolean) {
    const { token } = await enableIssueShare(issue.id, extended);
    await qc.invalidateQueries({ queryKey: qk.issue(issue.id) });
    return token;
  }
  async function disableShare() {
    await disableIssueShare(issue.id);
    await qc.invalidateQueries({ queryKey: qk.issue(issue.id) });
  }

  // Manual actions whose condition matches this issue, applied as one patch.
  // Applying one is a issue edit; Copy Prompt only reads the issue and is always
  // available, so the block always renders.
  const issueActions = canEdit ? matchedActions(actionsQuery.data ?? [], project, issue) : [];

  async function copyPrompt() {
    await copyText(buildIssuePrompt(issue, project, session?.user));
    // Confirmed like the short link and the branch name.
    toast.success(tCommands('promptCopied'));
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  }

  // The issue's short identifier link (/IAP-62) redirects to the canonical page URL.
  async function copyLink() {
    await copyText(`${window.location.origin}/${issue.identifier}`);
    toast.success(t('shortLinkCopied'));
  }

  async function copyBranch() {
    await copyText(buildIssueBranchName(issue, session?.user));
    toast.success(t('branchCopied'));
  }

  // One list of what can be done with the task: in the overlay's head and in the panel it is
  // ONE "..." menu (ActionMenu), on the task's page the page's own action row (below).
  const menuItems: ActionMenuItem[] = [
    { id: 'link', label: t('copyShortLink'), icon: <Share2 />, onSelect: () => void copyLink() },
    {
      id: 'branch',
      label: t('copyBranch'),
      icon: <GitBranch />,
      onSelect: () => void copyBranch(),
    },
    {
      id: 'prompt',
      label: copied ? t('copied') : t('copyPrompt'),
      icon: copied ? <Check /> : <ClipboardCopy />,
      onSelect: () => void copyPrompt(),
    },
    ...(canEdit
      ? [
          {
            id: 'share',
            label: issue.shareToken ? t('sharedPublicly') : t('sharePublicly'),
            icon: <Globe />,
            onSelect: () => setSharing(true),
          },
        ]
      : []),
    ...issueActions.map((a) => {
      const Icon = actionIcon(a.icon);
      return {
        id: `action-${a.id}`,
        label: a.name,
        icon: <Icon />,
        onSelect: () => setConfirmingAction(a),
      };
    }),
    ...(canEdit
      ? [
          {
            id: 'archive',
            label: issue.archivedAt ? t('restore') : t('archive'),
            icon: issue.archivedAt ? <ArchiveRestore /> : <Archive />,
            onSelect: () => (issue.archivedAt ? restoreIssue.mutate(issue.id) : archive(issue)),
          },
        ]
      : []),
    ...(canDelete
      ? [
          {
            id: 'delete',
            label: t('delete'),
            icon: <Trash2 />,
            danger: true,
            onSelect: () => setConfirmingDelete(true),
          },
        ]
      : []),
  ];
  const menu = <ActionMenu label={tCommon('more')} items={menuItems} />;

  // The same actions as the page's header row: icons with their tooltip, delete in
  // the "…" menu.
  const toolbarActions: PageAction[] = [
    { id: 'link', label: t('copyShortLink'), icon: Share2, onClick: () => void copyLink() },
    { id: 'branch', label: t('copyBranch'), icon: GitBranch, onClick: () => void copyBranch() },
    {
      id: 'prompt',
      label: copied ? t('copied') : t('copyPrompt'),
      icon: copied ? Check : ClipboardCopy,
      onClick: () => void copyPrompt(),
    },
    ...(canEdit
      ? [
          {
            id: 'share',
            label: issue.shareToken ? t('sharedPublicly') : t('sharePublicly'),
            icon: Globe,
            onClick: () => setSharing(true),
          },
        ]
      : []),
    ...issueActions.map((a) => ({
      id: `action-${a.id}`,
      label: a.name,
      icon: actionIcon(a.icon),
      onClick: () => setConfirmingAction(a),
    })),
    ...(canEdit
      ? [
          {
            id: 'archive',
            label: issue.archivedAt ? t('restore') : t('archive'),
            icon: issue.archivedAt ? ArchiveRestore : Archive,
            onClick: () => (issue.archivedAt ? restoreIssue.mutate(issue.id) : archive(issue)),
          },
        ]
      : []),
    ...(canDelete
      ? [
          {
            id: 'delete',
            label: t('delete'),
            icon: Trash2,
            menuOnly: true,
            onClick: () => setConfirmingDelete(true),
          },
        ]
      : []),
  ];

  return (
    <>
      {variant === 'toolbar' ? (
        <PageToolbar>
          <PageToolbarSpacer />
          <PageActions actions={toolbarActions} />
        </PageToolbar>
      ) : variant === 'header' ? (
        menu
      ) : (
        <div className="mb-3 flex justify-end px-1">{menu}</div>
      )}

      {confirmingDelete && (
        <DeleteIssueDialog
          project={project}
          issue={issue}
          onClose={() => setConfirmingDelete(false)}
          onDeleted={onDeleted}
        />
      )}

      {archiveDialog}

      {confirmingAction && (
        <ApplyActionDialog
          project={project}
          issue={issue}
          action={confirmingAction}
          onClose={() => setConfirmingAction(null)}
        />
      )}

      <ShareDialog
        open={sharing}
        onOpenChange={setSharing}
        title={t('shareIssue')}
        token={issue.shareToken}
        extended={issue.shareExtended}
        enable={share}
        disable={disableShare}
        pathForToken={shareIssuePath}
      />
    </>
  );
}
