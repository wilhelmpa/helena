'use client';

import { Card } from '@/design-system';
import Link from 'next/link';
import { AppWindow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ApprovalRequest } from '@/lib/api/endpoints/approvals';
import { formatDateTime } from '@/utils/dates';
import { issuePath } from '@/utils/paths';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import CodeBlock from '@/components/common/CodeBlock';
import { useDecideApproval } from '../services/approvals.service';
import ApprovalDecisionForm from '@/components/common/ApprovalDecisionForm';
import ApprovalDecisionSummary from './ApprovalDecisionSummary';
import BudgetApprovalCard from './BudgetApprovalCard';
import ApprovalPolicyReason from '@/features/autopilot/components/ApprovalPolicyReason';

// One agent's request: what it wants to do, who asks and for which task, and either the
// decision controls or the decision it got.
// An agent's request to take over its project browser (browser_handover) names the live
// view; the card opens it.
const LIVE_VIEW_LINK = /\/project\/[A-Za-z0-9_-]{1,32}\?tool=browser/;

export default function ApprovalRequestCard({ request }: { request: ApprovalRequest }) {
  // A used-up budget has its own answers (raise, continue once, keep stopped).
  if (request.kind === 'budget') return <BudgetApprovalCard request={request} />;
  return <AgentRequestCard request={request} />;
}

function AgentRequestCard({ request }: { request: ApprovalRequest }) {
  const t = useTranslations('approvals');
  const decide = useDecideApproval();
  const liveView = LIVE_VIEW_LINK.exec(request.details)?.[0] ?? null;

  return (
    <Card as="article">
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
      <p className="text-md font-medium" dir="auto">
        {request.action}
      </p>
      {request.details && (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground" dir="auto">
          {request.details}
        </p>
      )}
      {liveView && request.status === 'pending' && (
        <Button size="sm" variant="outline" asChild>
          <Link href={liveView}>
            <AppWindow />
            {t('openBrowser')}
          </Link>
        </Button>
      )}
      {request.command && <CodeBlock code={request.command} />}
      <ApprovalPolicyReason request={request} />
      {request.status === 'pending' ? (
        <ApprovalDecisionForm
          pending={decide.isPending}
          onDecide={(decision) => decide.mutate({ id: request.id, decision })}
        />
      ) : (
        <ApprovalDecisionSummary request={request} />
      )}
    </Card>
  );
}
