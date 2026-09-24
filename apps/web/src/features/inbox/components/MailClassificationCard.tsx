'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ListPlus, Reply, Split } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MAIL_CATEGORIES,
  MAIL_PRIORITIES,
  acceptMailSuggestion,
  classifyMailThread,
  correctMailClassification,
  getMailClassification,
} from '@/lib/api/endpoints/mailTriage';
import { cn } from '@/lib/utils';

const key = (threadId: number) => ['mail-classification', threadId] as const;

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : ` ${Math.round(value * 100)} %`;
}

// What the mail classifier made of the thread (docs/helena-decisions/decisions.md §5): kind,
// priority and whether it needs a reply, each correctable (the correction goes to the decision
// log), and the suggested task or hand-over to an agent as buttons — pressing one is the
// owner's approval. Without a classification: "Einordnen".
export function MailClassificationCard({ threadId }: { threadId: number }) {
  const t = useTranslations('mail.triage');
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: key(threadId),
    queryFn: () => getMailClassification(threadId),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key(threadId) });
    void qc.invalidateQueries({ queryKey: ['mail'] });
  };
  const classify = useMutation({
    mutationFn: () => classifyMailThread(threadId),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });
  const correct = useMutation({
    mutationFn: (body: { category?: string; priority?: string; needsReply?: boolean }) =>
      correctMailClassification(threadId, body),
    onSuccess: () => {
      toast.success(t('corrected'));
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const accept = useMutation({
    mutationFn: (kind: 'task' | 'agent') => acceptMailSuggestion(threadId, kind),
    onSuccess: () => {
      toast.success(t('accepted'));
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (query.isPending) return null;
  const classification = query.data?.classification ?? null;
  if (!classification) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={classify.isPending}
          onClick={() => classify.mutate()}
        >
          <Split />
          {t('classify')}
        </Button>
      </div>
    );
  }
  const answers = classification.answers;
  const unsure = (id: string) => answers[id] && !answers[id]!.decided;
  const suggested = classification.actions.filter((action) => action.note === 'suggested');

  return (
    <div className="flex flex-col gap-2 rounded-md border border-sidebar-border bg-card px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Split className="size-4 text-muted-foreground" aria-hidden />
        <Select
          value={classification.category ?? ''}
          onValueChange={(category) => correct.mutate({ category })}
        >
          <SelectTrigger
            className={cn(
              'h-7 w-auto gap-1 text-xs',
              unsure('category') && 'text-muted-foreground',
            )}
            aria-label={t('category')}
          >
            <SelectValue
              placeholder={
                answers.category?.choice
                  ? `${t(`categories.${answers.category.choice}` as never)}?${pct(answers.category.confidence)}`
                  : t('category')
              }
            />
          </SelectTrigger>
          <SelectContent>
            {MAIL_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {t(`categories.${category}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={classification.priority ?? ''}
          onValueChange={(priority) => correct.mutate({ priority })}
        >
          <SelectTrigger
            className={cn(
              'h-7 w-auto gap-1 text-xs',
              unsure('priority') && 'text-muted-foreground',
            )}
            aria-label={t('priority')}
          >
            <SelectValue placeholder={t('priority')} />
          </SelectTrigger>
          <SelectContent>
            {MAIL_PRIORITIES.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {t(`priorities.${priority}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-md border border-sidebar-border px-2 text-xs hover:bg-accent',
            classification.needsReply ? 'text-foreground' : 'text-muted-foreground',
          )}
          aria-pressed={classification.needsReply === true}
          onClick={() => correct.mutate({ needsReply: !classification.needsReply })}
        >
          <Reply className="size-3.5" aria-hidden />
          {classification.needsReply ? t('needsReply') : t('noReply')}
        </button>
        {classification.status !== 'classified' && (
          <span className="text-xs text-muted-foreground">
            {classification.status === 'failed' ? t('failed') : t('unsure')}
          </span>
        )}
      </div>
      {suggested.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {suggested.some((action) => action.kind === 'task') && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={accept.isPending}
              onClick={() => accept.mutate('task')}
            >
              <ListPlus />
              {t('createTask')}
            </Button>
          )}
          {suggested.some((action) => action.kind === 'agent') && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={accept.isPending}
              onClick={() => accept.mutate('agent')}
            >
              <Bot />
              {t('handToAgent')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
