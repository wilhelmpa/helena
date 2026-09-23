'use client';

import { useMemo, useState } from 'react';
import type { DynamicToolUIPart } from 'ai';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, ShieldQuestion, X } from 'lucide-react';
import { decideApproval, getApproval, type ApprovalRequest } from '@/lib/api/endpoints/approvals';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime } from '@/utils/dates';

// What `request_approval`'s tool result carries — the same shape the approvals API
// answers with, parsed back out of the JSON a tool result always is.
function parseApproval(output: unknown): Pick<ApprovalRequest, 'id' | 'status'> | null {
  const value = typeof output === 'string' ? tryParse(output) : output;
  if (!value || typeof value !== 'object') return null;
  const id = (value as { id?: unknown }).id;
  const status = (value as { status?: unknown }).status;
  if (typeof id !== 'number') return null;
  return {
    id,
    status: typeof status === 'string' ? (status as ApprovalRequest['status']) : 'pending',
  };
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The freeze frame of a `request_approval` call: what the agent asked for, and either
// the approve/reject controls (tied to the same approvals API the Approvals page uses)
// or the decision it already got. Refetches on an interval while pending, so an
// approval decided from the Approvals page or from Home also updates here.
export default function ChatApprovalCard({ tool }: { tool: DynamicToolUIPart }) {
  const t = useTranslations('chatWorkspace');
  const client = useQueryClient();
  const [note, setNote] = useState('');
  const parsed = useMemo(
    () => (tool.state === 'output-available' ? parseApproval(tool.output) : null),
    [tool],
  );

  const query = useQuery({
    queryKey: ['chatWorkspace', 'approval', parsed?.id],
    queryFn: () => getApproval(parsed!.id),
    enabled: parsed != null,
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 5000 : false),
  });

  const decide = useMutation({
    mutationFn: (approved: boolean) =>
      decideApproval(parsed!.id, { approved, note: note.trim() || undefined }),
    onSuccess: (updated) => {
      toast.success(
        t(updated.status === 'approved' ? 'approval.approvedToast' : 'approval.rejectedToast'),
      );
      client.setQueryData(['chatWorkspace', 'approval', parsed?.id], updated);
    },
  });

  if (!parsed) return null;
  const request = query.data;

  return (
    <div className="max-w-md space-y-2.5 rounded-lg border bg-card p-3.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldQuestion className="size-4 shrink-0" />
        {request ? (
          <Badge variant="outline">{t(`approval.kind.${request.kind}`)}</Badge>
        ) : (
          <Badge variant="outline">{t('approval.title')}</Badge>
        )}
        {request && <span className="ms-auto">{formatDateTime(request.createdAt)}</span>}
      </div>
      {request ? (
        <>
          <p dir="auto" className="text-sm font-medium">
            {request.action}
          </p>
          {request.details && (
            <p dir="auto" className="text-sm whitespace-pre-wrap text-muted-foreground">
              {request.details}
            </p>
          )}
          {request.status === 'pending' ? (
            <div className="space-y-2">
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t('approval.notePlaceholder')}
                aria-label={t('approval.notePlaceholder')}
                maxLength={2000}
                rows={2}
                dir="auto"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate(false)}
                >
                  <X className="size-4" /> {t('approval.reject')}
                </Button>
                <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
                  <Check className="size-4" /> {t('approval.approve')}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t(request.status === 'approved' ? 'approval.approvedBy' : 'approval.rejectedBy', {
                name: request.decidedByName ?? '',
              })}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t('approval.loading')}</p>
      )}
    </div>
  );
}
