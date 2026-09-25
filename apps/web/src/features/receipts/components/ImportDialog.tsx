'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BankAccount, BankImportResult } from '@/lib/api/endpoints/receipts';
import { useCreateBankAccount, useImportStatement } from '../services/receipts.service';

const NEW_ACCOUNT = 'new';

// "Kontoauszug importieren": a CAMT file (or the ZIP the bank delivers), or a CSV export,
// into one of the project's accounts — or into a new one, which takes the IBAN of the file.
// The result says what was new, what was already there and what the parser noticed.
export function ImportDialog({
  projectKey,
  accounts,
  initialAccountId,
  onClose,
}: {
  projectKey: string;
  accounts: BankAccount[];
  initialAccountId?: number | null;
  onClose: () => void;
}) {
  const t = useTranslations('receipts.import');
  const tCommon = useTranslations('common');
  const create = useCreateBankAccount(projectKey);
  const run = useImportStatement(projectKey);
  const [accountId, setAccountId] = useState<string>(
    String(initialAccountId ?? accounts[0]?.id ?? NEW_ACCOUNT),
  );
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BankImportResult | null>(null);
  const busy = create.isPending || run.isPending;
  const creating = accountId === NEW_ACCOUNT;

  async function submit() {
    if (!file) return;
    const target = creating
      ? (await create.mutateAsync({ name: name.trim() })).id
      : Number(accountId);
    setResult(await run.mutateAsync({ accountId: target, file }));
  }

  if (result) {
    return (
      <Modal title={t('doneTitle')} scope={projectKey} onClose={onClose}>
        <div className="flex flex-col gap-3 text-sm">
          <p>{t('result', { added: result.added, duplicates: result.duplicates })}</p>
          {result.pending > 0 && (
            <p className="text-muted-foreground">{t('pending', { count: result.pending })}</p>
          )}
          {result.matched > 0 && <p>{t('matched', { count: result.matched })}</p>}
          {result.warnings.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground">{t('warnings')}</p>
              <ul className="list-disc space-y-0.5 ps-5 text-xs text-muted-foreground">
                {result.warnings.map((warning, index) => (
                  <li key={index} className="break-words">
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>{tCommon('done')}</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t('title')} scope={projectKey} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="receipts-import-account">{t('account')}</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger id="receipts-import-account" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={String(account.id)}>
                  {account.name}
                  {account.iban ? ` · ${account.iban}` : ''}
                </SelectItem>
              ))}
              <SelectItem value={NEW_ACCOUNT}>{t('newAccount')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {creating && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="receipts-import-name">{t('accountName')}</Label>
            <Input
              id="receipts-import-name"
              value={name}
              placeholder={t('accountNamePlaceholder')}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('ibanFromFile')}</p>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="receipts-import-file">{t('file')}</Label>
          <Input
            id="receipts-import-file"
            type="file"
            accept=".xml,.csv,.txt,.zip"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">{t('fileHint')}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            disabled={busy || !file || (creating && !name.trim())}
            onClick={() => void submit().catch(() => undefined)}
          >
            {busy ? t('importing') : t('submit')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
