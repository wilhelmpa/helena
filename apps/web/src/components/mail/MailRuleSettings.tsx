'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MailAccount, MailRuleMatch } from '@/lib/api/endpoints/mail';
import { useCreateMailRule, useDeleteMailRule, useMailRules } from '@/services/mail.service';
import MailProjectSelect from './MailProjectSelect';

const ALL = 'all';

// Files new mail by sender under a project: an address or a whole domain, for one
// account or for all of them.
export default function MailRuleSettings({
  teamId,
  accounts,
  canEdit,
}: {
  teamId: number;
  accounts: MailAccount[];
  canEdit: boolean;
}) {
  const t = useTranslations('mail.rules');
  const rules = useMailRules(teamId);
  const create = useCreateMailRule(teamId);
  const remove = useDeleteMailRule(teamId);
  const [matchType, setMatchType] = useState<MailRuleMatch>('domain');
  const [value, setValue] = useState('');
  const [projectId, setProjectId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [existing, setExisting] = useState(false);
  const accountLabel = (id: number | null) =>
    id == null ? t('allAccounts') : (accounts.find((item) => item.id === id)?.address ?? '');

  return (
    <section className="flex flex-col gap-3 border-t pt-4">
      <h3 className="text-sm font-medium">{t('title')}</h3>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <ul className="flex flex-col gap-1">
        {(rules.data ?? []).map((rule) => (
          <li
            key={rule.id}
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
          >
            <span className="font-mono text-xs">
              {rule.matchType === 'domain' ? `@${rule.value}` : rule.value}
            </span>
            <span className="text-muted-foreground">→ {rule.projectName}</span>
            <span className="text-xs text-muted-foreground">({accountLabel(rule.accountId)})</span>
            {canEdit && (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="ms-auto"
                aria-label={t('remove')}
                onClick={() => remove.mutate(rule.id)}
              >
                <X />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!projectId || !value.trim()) return;
            create.mutate(
              { accountId, matchType, value: value.trim(), projectId, applyToExisting: existing },
              {
                onSuccess: (created) => {
                  setValue('');
                  toast.success(t('added', { count: created.movedThreads }));
                },
              },
            );
          }}
        >
          <div className="flex gap-2">
            <Select value={matchType} onValueChange={(next) => setMatchType(next as MailRuleMatch)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="domain">{t('domain')}</SelectItem>
                <SelectItem value="address">{t('address')}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={t(matchType === 'domain' ? 'domainPlaceholder' : 'addressPlaceholder')}
            />
          </div>
          <Select
            value={accountId == null ? ALL : String(accountId)}
            onValueChange={(next) => setAccountId(next === ALL ? null : Number(next))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allAccounts')}</SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={String(account.id)}>
                  {account.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <MailProjectSelect
            teamId={teamId}
            value={projectId}
            onChange={setProjectId}
            label={t('project')}
            allowHome={false}
          />
          <label className="flex items-center gap-2 self-end text-sm">
            <Checkbox
              checked={existing}
              onCheckedChange={(checked) => setExisting(checked === true)}
            />
            {t('applyToExisting')}
          </label>
          <Button
            type="submit"
            size="sm"
            className="sm:col-span-2 sm:justify-self-end"
            disabled={!projectId || !value.trim() || create.isPending}
          >
            {t('add')}
          </Button>
        </form>
      )}
    </section>
  );
}
