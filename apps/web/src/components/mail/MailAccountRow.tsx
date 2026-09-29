'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { MailAccount } from '@/lib/api/endpoints/mail';
import {
  useDeleteMailAccount,
  useResetMailAccount,
  useTestMailConnection,
} from '@/services/mail.service';
import { MailboxSettingsDialog } from '@/features/access/MailboxSettingsDialog';
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
  const tBox = useTranslations('access.mailbox');
  const test = useTestMailConnection(teamId);
  const remove = useDeleteMailAccount(teamId);
  const reset = useResetMailAccount(teamId);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [settings, setSettings] = useState(false);
  const google = account.auth === 'xoauth2';
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
    <li className="flex flex-col gap-2 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {account.address} · {account.projectName ?? t('home')}
          </p>
        </div>
        {google && (
          <Badge variant="outline" className="font-normal">
            {tBox('google')}
          </Badge>
        )}
        <Badge
          variant={
            status === 'error' ? 'destructive' : status === 'synced' ? 'secondary' : 'outline'
          }
        >
          {account.resetPending ? tBox('resetPending') : t(`status.${status}`)}
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
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => (google ? setSettings(true) : onEdit())}
            >
              {t('edit')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={account.resetPending}
              onClick={() => setResetting(true)}
            >
              {tBox('reset')}
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
            className="h-1.5 flex-1 overflow-hidden rounded-sm bg-muted"
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
      {settings && (
        <MailboxSettingsDialog
          teamId={teamId}
          account={account}
          onClose={() => setSettings(false)}
        />
      )}
      {resetting && (
        <ConfirmDialog
          title={tBox('resetTitle', { address: account.address })}
          confirmLabel={tBox('reset')}
          onClose={() => setResetting(false)}
          onConfirm={async () => {
            await reset.mutateAsync(account.id);
            toast.success(tBox('resetDone', { address: account.address }));
            setResetting(false);
          }}
        >
          <p className="text-sm text-muted-foreground">{tBox('resetMessage')}</p>
        </ConfirmDialog>
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
