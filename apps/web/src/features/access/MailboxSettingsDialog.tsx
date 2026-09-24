'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import Modal from '@/components/common/overlay/Modal';
import MailProjectSelect from '@/components/mail/MailProjectSelect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { MailAccount } from '@/lib/api/endpoints/mail';
import { useSaveMailAccount } from '@/services/mail.service';
import { MailboxWindowField } from './MailboxWindowField';

// The mailbox of a Google account's Mail service: its name, project, which folders it
// imports and its fetch window. Servers and login belong to the Google account.
export function MailboxSettingsDialog({
  teamId,
  account,
  onClose,
}: {
  teamId: number;
  account: MailAccount;
  onClose: () => void;
}) {
  const t = useTranslations('access.mailbox');
  const tMail = useTranslations('mail.accounts');
  const tCommon = useTranslations('common');
  const [name, setName] = useState(account.name);
  const [projectId, setProjectId] = useState(account.projectId);
  const [flags, setFlags] = useState({
    enabled: account.enabled,
    syncTrash: account.syncTrash,
    syncSpam: account.syncSpam,
  });
  const [window, setWindow] = useState({
    all: account.fetchDays == null,
    days: account.fetchDays ?? 30,
  });
  const save = useSaveMailAccount(teamId);

  function submit() {
    save.mutate(
      {
        id: account.id,
        input: {
          name: name.trim() || account.address,
          projectId,
          ...flags,
          fetchDays: window.all ? null : window.days,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('saved', { address: account.address }));
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      title={t('settingsTitle', { address: account.address })}
      description={t('googleHint')}
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mailbox-name">{tMail('name')}</Label>
          <Input id="mailbox-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <MailProjectSelect teamId={teamId} value={projectId} onChange={setProjectId} />
        <MailboxWindowField value={window} onChange={setWindow} />
        <div className="flex flex-col gap-2 text-sm">
          {(['enabled', 'syncTrash', 'syncSpam'] as const).map((key) => (
            <label key={key} className="flex items-center gap-2">
              <Switch
                checked={flags[key]}
                onCheckedChange={(checked) =>
                  setFlags((current) => ({ ...current, [key]: checked }))
                }
              />
              {tMail(key)}
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {tCommon('save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
