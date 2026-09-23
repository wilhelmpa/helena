import { CircleCheck, CircleX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ApprovalRequest } from '@/lib/api/endpoints/approvals';
import { formatDateTime } from '@/utils/dates';

export default function ApprovalDecisionSummary({ request }: { request: ApprovalRequest }) {
  const t = useTranslations('approvals');
  const approved = request.status === 'approved';
  const Icon = approved ? CircleCheck : CircleX;
  const name = request.decidedByName ?? t('someone');

  return (
    <div className="space-y-1 border-t pt-3 text-sm">
      <p className="flex flex-wrap items-center gap-x-2">
        <Icon className={approved ? 'size-4 text-emerald-600' : 'size-4 text-destructive'} />
        <span className="font-medium">
          {approved ? t('approvedBy', { name }) : t('rejectedBy', { name })}
        </span>
        {request.decidedAt && (
          <span className="text-xs text-muted-foreground">{formatDateTime(request.decidedAt)}</span>
        )}
      </p>
      {request.note && (
        <p className="whitespace-pre-wrap text-muted-foreground" dir="auto">
          {request.note}
        </p>
      )}
    </div>
  );
}
