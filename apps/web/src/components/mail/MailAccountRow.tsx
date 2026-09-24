'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { MailAccount } from '@/lib/api/endpoints/mail';
import { useDeleteMailAccount, useTestMailConnection } from '@/services/mail.service';
import { formatDateTime } from '@/utils/dates';

function statusKey(account: MailAccount) {
  if (!account.enabled) return 'off';
  if (!account.hasPassword) return 'noPassword';
  return account.syncStatus;
}

export default function MailAccountRow({
  account,
  teamId,
  canEdit,
  onEdit,
}: {
  account: MailAccount;
  teamId: number;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations('mail.accounts');
  const test = useTestMailConnection(teamId);
  const remove = useDeleteMailAccount(teamId);
  const [confirming, setConfirming] = useState(false);
  const status = statusKey(account);
  const { synced, total } = account.progress;
  const percent = total > 0 ? Math.min(100, Math.floor((synced / total) * 100)) : 0;

  const runTest = () =>
    test.mutate(
      {
        imapHost: account.imapHost,
        imapPort: account.imapPort,
        imapTls: account.imapTls,
        smtpHost: account.smtpHost,
        smtpPort: account.smtpPort,
        smtpTls: account.smtpTls,
        username: account.username,
        accountId: account.id,
      },
      {
        onSuccess: (result) =>
          result.imap || result.smtp
            ? toast.error(t('testFailed', { error: result.imap ?? result.smtp ?? '' }))
            : toast.success(t('testOk')),
      },
    );

  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {account.address} · {account.projectName ?? t('home')}
          </p>
        </div>
        <Badge
          variant={
            status === 'error' ? 'destructive' : status === 'synced' ? 'secondary' : 'outline'
          }
        >
          {t(`status.${status}`)}
        </Badge>
        {canEdit && (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={test.isPending || !account.hasPassword}
              onClick={runTest}
            >
              {test.isPending ? t('testing') : t('test')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
              {t('edit')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              {t('remove')}
            </Button>
          </>
        )}
      </div>
      {status === 'importing' && total > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded bg-muted"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
          {t('progress', { synced, total })}
        </div>
      )}
      {account.syncError && <p className="text-xs text-destructive">{account.syncError}</p>}
      {account.lastSyncAt && (
        <p className="text-xs text-muted-foreground">
          {t('lastSync', { at: formatDateTime(account.lastSyncAt) })}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title={t('removeTitle', { address: account.address })}
          confirmLabel={t('remove')}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await remove.mutateAsync(account.id);
            setConfirming(false);
          }}
        >
          <p className="text-sm text-muted-foreground">{t('removeBody')}</p>
        </ConfirmDialog>
      )}
    </li>
  );
}
