'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ApprovalDecision } from '@/lib/api/endpoints/approvals';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export default function ApprovalDecisionForm({
  pending,
  onDecide,
}: {
  pending: boolean;
  onDecide: (decision: ApprovalDecision) => void;
}) {
  const t = useTranslations('approvals');
  const [note, setNote] = useState('');
  const decide = (approved: boolean) => onDecide({ approved, note: note.trim() || undefined });

  return (
    <div className="space-y-2">
      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={t('notePlaceholder')}
        aria-label={t('notePlaceholder')}
        maxLength={2000}
        rows={2}
        dir="auto"
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={pending} onClick={() => decide(false)}>
          <X className="size-4" /> {t('reject')}
        </Button>
        <Button size="sm" disabled={pending} onClick={() => decide(true)}>
          <Check className="size-4" /> {t('approve')}
        </Button>
      </div>
    </div>
  );
}
