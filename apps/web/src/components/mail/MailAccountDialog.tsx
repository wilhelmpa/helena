'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { MailAccount, MailAccountInput } from '@/lib/api/endpoints/mail';
import { useSaveMailAccount, useTestMailConnection } from '@/services/mail.service';
import MailPasswordField from './MailPasswordField';
import MailProjectSelect from './MailProjectSelect';
import MailServerFields from './MailServerFields';
import { GOOGLE_PRESET, isGooglePreset } from './mailPresets';

type Form = Omit<MailAccountInput, 'password'> & { password: string };

// The account's current secret is kept unless another is picked or a password typed.
function passwordInput(form: Form, account: MailAccount | null): Partial<MailAccountInput> {
  const { password, credentialId, ...rest } = form;
  if (password) return { ...rest, password };
  if (credentialId != null && credentialId !== account?.credentialId)
    return { ...rest, credentialId };
  return rest;
}

function initial(account: MailAccount | null, projectId: number | null): Form {
  if (!account)
    return {
      name: '',
      address: '',
      projectId,
      ...GOOGLE_PRESET,
      username: '',
      password: '',
      enabled: true,
      syncTrash: false,
      syncSpam: false,
    };
  const {
    id: _id,
    teamId: _team,
    projectKey: _key,
    projectName: _name,
    hasPassword: _has,
    credentialId: _credentialId,
    credentialLabel: _credentialLabel,
    syncStatus: _status,
    syncError: _error,
    lastSyncAt: _at,
    progress: _progress,
    ...fields
  } = account;
  return { ...fields, password: '' };
}

// Adds or changes an account. Google is the default: its servers are filled in and
// the address is the user name. A password left empty keeps the stored one.
export default function MailAccountDialog({
  teamId,
  account,
  defaultProjectId,
  onClose,
}: {
  teamId: number;
  account: MailAccount | null;
  defaultProjectId: number | null;
  onClose: () => void;
}) {
  const t = useTranslations('mail.accounts');
  const [form, setForm] = useState<Form>(() => initial(account, defaultProjectId));
  const [result, setResult] = useState<{ imap: string | null; smtp: string | null } | null>(null);
  const save = useSaveMailAccount(teamId);
  const test = useTestMailConnection(teamId);
  const google = isGooglePreset(form);
  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));
  const ready =
    form.name.trim() &&
    form.address.includes('@') &&
    form.imapHost &&
    form.smtpHost &&
    form.username &&
    (account?.hasPassword || form.password || form.credentialId != null);

  const submit = () => {
    save.mutate(
      { id: account?.id ?? null, input: passwordInput(form, account) },
      {
        onSuccess: () => {
          toast.success(t(account ? 'saved' : 'added', { address: form.address }));
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      title={account ? t('editTitle') : t('addTitle')}
      description={t('dialogIntro')}
      onClose={onClose}
      wide
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mail-name">{t('name')}</Label>
            <Input
              id="mail-name"
              value={form.name}
              onChange={(event) => set({ name: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mail-address">{t('address')}</Label>
            <Input
              id="mail-address"
              type="email"
              value={form.address}
              onChange={(event) =>
                set({
                  address: event.target.value,
                  ...(google || form.username === form.address
                    ? { username: event.target.value }
                    : {}),
                })
              }
            />
          </div>
        </div>
        <MailProjectSelect
          teamId={teamId}
          value={form.projectId}
          onChange={(projectId) => set({ projectId })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('provider')}</span>
          <Button
            type="button"
            size="sm"
            variant={google ? 'secondary' : 'ghost'}
            onClick={() => set({ ...GOOGLE_PRESET, username: form.address })}
          >
            {t('google')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={google ? 'ghost' : 'secondary'}
            onClick={() => set({ imapHost: '', smtpHost: '' })}
          >
            {t('otherServer')}
          </Button>
        </div>
        {google ? (
          <p className="text-xs text-muted-foreground">{t('googleHint')}</p>
        ) : (
          <MailServerFields value={form} onChange={set} />
        )}
        <MailPasswordField
          teamId={teamId}
          projectId={form.projectId}
          label={google ? t('appPassword') : t('password')}
          password={form.password}
          credentialId={form.credentialId}
          storedLabel={account?.credentialLabel ?? null}
          onChange={set}
        />
        <div className="flex flex-col gap-2 text-sm">
          {(['enabled', 'syncTrash', 'syncSpam'] as const).map((key) => (
            <label key={key} className="flex items-center gap-2">
              <Switch
                checked={!!form[key]}
                onCheckedChange={(checked) => set({ [key]: checked })}
              />
              {t(key)}
            </label>
          ))}
        </div>
        {result && (
          <ul className="flex flex-col gap-1 rounded-md border p-2 text-xs">
            <li className={result.imap ? 'text-destructive' : ''}>
              IMAP: {result.imap ?? t('ok')}
            </li>
            <li className={result.smtp ? 'text-destructive' : ''}>
              SMTP: {result.smtp ?? t('ok')}
            </li>
          </ul>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={
              test.isPending ||
              !form.imapHost ||
              !form.smtpHost ||
              !(form.password || form.credentialId != null || account?.hasPassword)
            }
            onClick={() =>
              test.mutate(
                {
                  imapHost: form.imapHost,
                  imapPort: form.imapPort,
                  imapTls: form.imapTls,
                  smtpHost: form.smtpHost,
                  smtpPort: form.smtpPort,
                  smtpTls: form.smtpTls,
                  username: form.username,
                  password: form.password || undefined,
                  credentialId: form.password ? undefined : form.credentialId,
                  accountId: account?.id,
                },
                { onSuccess: setResult },
              )
            }
          >
            {test.isPending ? t('testing') : t('test')}
          </Button>
          <Button type="submit" disabled={!ready || save.isPending}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
