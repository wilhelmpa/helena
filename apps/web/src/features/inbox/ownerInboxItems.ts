import type { ApprovalRequest } from '@/lib/api/endpoints/approvals';
import type { PipelineApproval } from '@/lib/api/endpoints/pipelines';
import type { RuntimeProposal } from '@/lib/api/endpoints/agentRuntime';
import type { Notification } from '@/lib/api/endpoints/notifications';
import type { NeedsYouEntry } from '@/extensions/needsYouSources';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';

export type OwnerInboxItem =
  | { key: string; kind: 'approval'; projectKey: string; at: string; approval: ApprovalRequest }
  | { key: string; kind: 'step'; projectKey: string; at: string; step: PipelineApproval }
  | { key: string; kind: 'proposal'; projectKey: null; at: string; proposal: RuntimeProposal }
  | { key: string; kind: 'mention'; projectKey: string; at: string; notification: Notification }
  | {
      key: string;
      kind: 'problem' | 'failure';
      projectKey: string | null;
      at: string;
      entry: NeedsYouEntry;
    };

export function ownerInboxItems({
  approvals,
  steps,
  proposals,
  mentions,
  needs,
  activity,
}: {
  approvals: ApprovalRequest[];
  steps: PipelineApproval[];
  proposals: RuntimeProposal[];
  mentions: Notification[];
  needs: NeedsYouEntry[];
  activity: AgentActivityEntry[];
}): { actions: OwnerInboxItem[]; reads: AgentActivityEntry[] } {
  const busyIssues = new Set([
    ...approvals.map((item) => item.issueId),
    ...steps.map((item) => item.issueId),
  ]);
  const actions: OwnerInboxItem[] = [
    ...approvals.map((approval) => ({
      key: `approval:${approval.id}`,
      kind: 'approval' as const,
      projectKey: approval.projectKey,
      at: approval.createdAt,
      approval,
    })),
    ...steps.map((step) => ({
      key: `step:${step.runId}:${step.stepId}:${step.iteration}`,
      kind: 'step' as const,
      projectKey: step.projectKey,
      at: step.waitingSince,
      step,
    })),
    ...proposals.map((proposal) => ({
      key: `proposal:${proposal.id}`,
      kind: 'proposal' as const,
      projectKey: null,
      at: proposal.createdAt,
      proposal,
    })),
    ...mentions
      .filter(
        (notification) =>
          notification.type === 'mentioned' && !busyIssues.has(notification.issueId),
      )
      .map((notification) => ({
        key: `mention:${notification.id}`,
        kind: 'mention' as const,
        projectKey: notification.projectKey,
        at: notification.createdAt,
        notification,
      })),
    ...needs
      .filter((entry) => entry.kind === 'problem' || entry.kind === 'failure')
      .map((entry) => ({
        key: entry.key,
        kind: entry.kind as 'problem' | 'failure',
        projectKey: entry.projectKey ?? null,
        at: entry.at,
        entry,
      })),
  ];
  const seen = new Set<string>();
  const unique = actions.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
  const rank = (kind: OwnerInboxItem['kind']) =>
    kind === 'problem' || kind === 'failure' ? 0 : kind === 'mention' ? 2 : 1;
  unique.sort((a, b) => rank(a.kind) - rank(b.kind) || b.at.localeCompare(a.at));
  return {
    actions: unique,
    reads: activity.filter(
      (entry) =>
        entry.kind !== 'chat' && ['success', 'succeeded', 'completed'].includes(entry.status),
    ),
  };
}
