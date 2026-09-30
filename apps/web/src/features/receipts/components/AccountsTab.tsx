'use client';

import { useState, type ReactNode } from 'react';
import { FileUp, Landmark, Pencil, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { RowEmpty, RowList, ROW_CLASS, SectionLabel } from '@/components/common/page/RowList';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { BankAccount, BankImport } from '@/lib/api/endpoints/receipts';
import {
  useCreateBankAccount,
  useDeleteBankAccount,
  useUpdateBankAccount,
} from '../services/receipts.service';
import { formatDay } from '../utils/format';

// "Konten": the project's bank accounts with what they hold, and every statement import with
// its result. Accounts are added here or by the first import of a file.
export function AccountsTab({
  projectKey,
  accounts,
  imports,
  loading,
  onImport,
}: {
  projectKey: string;
  accounts: BankAccount[];
  imports: BankImport[];
  loading: boolean;
  onImport: (accountId: number) => void;
}) {
  const t = useTranslations('receipts.accounts');
  const locale = useLocale();
  const create = useCreateBankAccount(projectKey);
  const [name, setName] = useState('');
  const [iban, setIban] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<BankAccount | null>(null);
  const remove = useDeleteBankAccount(projectKey);
  if (loading) return <ListSkeleton rows={4} />;
  const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? '';

  function add() {
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), iban: iban.trim() || null },
      {
        onSuccess: () => {
          setName('');
          setIban('');
        },
      },
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <section>
        <SectionLabel trailing={<span className="tabular-nums">{accounts.length}</span>}>
          {t('title')}
        </SectionLabel>
        <RowList>
          {accounts.length === 0 && <RowEmpty>{t('none')}</RowEmpty>}
          {accounts.map((account) =>
            editing === account.id ? (
              <AccountEditor
                key={account.id}
                projectKey={projectKey}
                account={account}
                onDone={() => setEditing(null)}
              />
            ) : (
              <div key={account.id} className={`${ROW_CLASS} pe-1`}>
                <Landmark aria-hidden="true" />
                <span className="min-w-0 shrink truncate">{account.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                  {account.iban ?? t('noIban')}
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
                  {t('counts', {
                    open: account.open,
                    matched: account.matched,
                    ignored: account.ignored,
                  })}
                </span>
                <IconAction label={t('import')} onClick={() => onImport(account.id)}>
                  <FileUp />
                </IconAction>
                <IconAction label={t('edit')} onClick={() => setEditing(account.id)}>
                  <Pencil />
                </IconAction>
                <IconAction label={t('delete')} onClick={() => setDeleting(account)}>
                  <Trash2 />
                </IconAction>
              </div>
            ),
          )}
        </RowList>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            className="h-8 w-full min-w-0 sm:w-56"
            value={name}
            placeholder={t('namePlaceholder')}
            aria-label={t('name')}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && add()}
          />
          <Input
            className="h-8 w-full min-w-0 font-mono sm:w-72"
            value={iban}
            placeholder={t('ibanPlaceholder')}
            aria-label={t('iban')}
            onChange={(event) => setIban(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && add()}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!name.trim() || create.isPending}
            onClick={add}
          >
            {t('add')}
          </Button>
        </div>
      </section>

      <section>
        <SectionLabel trailing={<span className="tabular-nums">{imports.length}</span>}>
          {t('imports')}
        </SectionLabel>
        <RowList>
          {imports.length === 0 && <RowEmpty>{t('noImports')}</RowEmpty>}
          {imports.map((entry) => (
            <div key={entry.id} className="flex min-w-0 flex-col">
              <div className={`${ROW_CLASS} pe-1`}>
                <FileUp aria-hidden="true" />
                <span className="min-w-0 shrink truncate">{entry.filename}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {[
                    accountName(entry.bankAccountId),
                    formatDay(entry.createdAt, locale),
                    entry.fromDate && entry.toDate
                      ? `${formatDay(entry.fromDate, locale)} – ${formatDay(entry.toDate, locale)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {t('importResult', { added: entry.added, duplicates: entry.duplicates })}
                </span>
              </div>
              {entry.warnings.length > 0 && (
                <ul className="list-disc space-y-0.5 ps-12 pe-2 pb-1 text-xs text-muted-foreground">
                  {entry.warnings.slice(0, 5).map((warning, index) => (
                    <li key={index} className="break-words">
                      {warning}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </RowList>
      </section>

      {deleting && (
        <ConfirmDialog
          title={t('deleteTitle', { name: deleting.name })}
          confirmLabel={t('delete')}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id);
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        >
          <p>{t('deleteHint', { count: deleting.transactions })}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function AccountEditor({
  projectKey,
  account,
  onDone,
}: {
  projectKey: string;
  account: BankAccount;
  onDone: () => void;
}) {
  const t = useTranslations('receipts.accounts');
  const tCommon = useTranslations('common');
  const update = useUpdateBankAccount(projectKey);
  const [name, setName] = useState(account.name);
  const [iban, setIban] = useState(account.iban ?? '');
  const save = () =>
    update.mutate(
      { accountId: account.id, body: { name: name.trim(), iban: iban.trim() || null } },
      { onSuccess: onDone },
    );
  return (
    <div className="flex flex-wrap items-center gap-2 p-1">
      <Input
        className="h-8 w-full min-w-0 sm:w-56"
        value={name}
        aria-label={t('name')}
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        className="h-8 w-full min-w-0 font-mono sm:w-72"
        value={iban}
        aria-label={t('iban')}
        placeholder={t('ibanPlaceholder')}
        onChange={(event) => setIban(event.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!name.trim() || update.isPending}
        onClick={save}
      >
        {tCommon('save')}
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        {tCommon('cancel')}
      </Button>
    </div>
  );
}
