'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ApprovalRequest } from '@/lib/api/endpoints/approvals';
import { formatDateTime } from '@/utils/dates';
import { issuePath } from '@/utils/paths';
import { Badge } from '@/components/ui/badge';
import CodeBlock from '@/components/common/CodeBlock';
import { useDecideApproval } from '../services/approvals.service';
import ApprovalDecisionForm from './ApprovalDecisionForm';
import ApprovalDecisionSummary from './ApprovalDecisionSummary';

// One agent's request: what it wants to do, who asks and for which task, and either the
// decision controls or the decision it got.
export default function ApprovalRequestCard({ request }: { request: ApprovalRequest }) {
  const t = useTranslations('approvals');
  const decide = useDecideApproval();

  return (
    <article className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Badge variant="outline">{t(`kind.${request.kind}`)}</Badge>
        <span>
          {t('requestedBy', {
            agent: request.agentName,
            username: request.agentUsername,
            project: request.projectName,
          })}
        </span>
        {request.issueSequenceNumber != null && (
          <Link
            href={issuePath(request.projectKey, request.issueSequenceNumber)}
            className="truncate hover:underline"
          >
            <span dir="ltr">{request.issueIdentifier}</span>
            {request.issueTitle && <span dir="auto"> · {request.issueTitle}</span>}
          </Link>
        )}
        <span className="ms-auto">{formatDateTime(request.createdAt)}</span>
      </div>
      <p className="font-medium" dir="auto">
        {request.action}
      </p>
      {request.details && (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground" dir="auto">
          {request.details}
        </p>
      )}
      {request.command && <CodeBlock code={request.command} />}
      {request.status === 'pending' ? (
        <ApprovalDecisionForm
          pending={decide.isPending}
          onDecide={(decision) => decide.mutate({ id: request.id, decision })}
        />
      ) : (
        <ApprovalDecisionSummary request={request} />
      )}
    </article>
  );
}
