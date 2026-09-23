'use client';

import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MailDraft } from '@/lib/api/endpoints/mail';
import { useMailAccounts } from '@/services/mail.service';
import { useSaveDraft } from '../services/drafts.service';

// The account the mail goes out from. Someone who cannot list the accounts sees the
// draft's one.
export default function ComposeFrom({ draft, editable }: { draft: MailDraft; editable: boolean }) {
  const t = useTranslations('mail.compose');
  const accounts = useMailAccounts(draft.teamId);
  const save = useSaveDraft(draft.id);
  const options = accounts.data ?? [];
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-10 shrink-0 text-muted-foreground">{t('from')}</span>
      {editable && options.length > 1 ? (
        <Select
          value={String(draft.accountId)}
          onValueChange={(value) => save.mutate({ accountId: Number(value) })}
        >
          <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label={t('from')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((account) => (
              <SelectItem key={account.id} value={String(account.id)}>
                {account.name} &lt;{account.address}&gt;
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="truncate">{draft.accountAddress}</span>
      )}
    </div>
  );
}
