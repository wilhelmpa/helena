'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import Modal from '@/components/common/overlay/Modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { GoogleAccount, GoogleService } from '@/lib/api/endpoints/access';
import { useUpdateGoogleAccount } from '@/services/access.service';
import { MailboxWindowField, type WindowValue } from '../MailboxWindowField';
import { useSaveMailAccount } from '@/services/mail.service';

// The services of a Google account the owner switches on. Mail is the account's mailbox
// in the inbox as well, with its fetch window; a service the last sign-in did not cover
// needs a new one first.
export function ServicesDialog({
  teamId,
  account,
  onClose,
}: {
  teamId: number;
  account: GoogleAccount;
  onClose: () => void;
}) {
  const t = useTranslations('access.servicesDialog');
  const tGoogle = useTranslations('access.google');
  const tCommon = useTranslations('common');
  const [enabled, setEnabled] = useState(
    () =>
      new Set(account.services.filter((service) => service.enabled).map((service) => service.id)),
  );
  const [window, setWindow] = useState<WindowValue>(() => ({
    all: account.mail?.fetchDays == null && account.mail !== null,
    days: account.mail?.fetchDays ?? 30,
  }));
  const update = useUpdateGoogleAccount(teamId);
  const saveMailbox = useSaveMailAccount(teamId);

  const toggle = (service: GoogleService, on: boolean) =>
    setEnabled((current) => {
      const next = new Set(current);
      if (on) next.add(service);
      else next.delete(service);
      return next;
    });

  async function submit() {
    try {
      await update.mutateAsync({ id: account.id, input: { services: [...enabled] } });
      const fetchDays = window.all ? null : window.days;
      if (account.mail && fetchDays !== account.mail.fetchDays) {
        await saveMailbox.mutateAsync({ id: account.mail.accountId, input: { fetchDays } });
      }
      toast.success(t('saved'));
      onClose();
    } catch {
      // Toasted by the request layer.
    }
  }

  return (
    <Modal title={t('title', { email: account.email })} description={t('hint')} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ul className="divide-y rounded-md border border-sidebar-border bg-card">
          {account.services.map((service) => (
            <li key={service.id} className="flex min-h-10 items-center gap-3 px-3 py-1.5">
              <span className="flex-1 text-sm">{tGoogle(`services.${service.id}`)}</span>
              {enabled.has(service.id) && !service.granted && (
                <Badge variant="outline" className="text-xs font-normal">
                  {t('needsSignIn')}
                </Badge>
              )}
              <Switch
                checked={enabled.has(service.id)}
                onCheckedChange={(on) => toggle(service.id, on)}
                aria-label={tGoogle(`services.${service.id}`)}
              />
            </li>
          ))}
        </ul>
        {account.engine === 'gog' && enabled.has('mail') && (
          <p className="text-xs text-muted-foreground">{t('gogNoMail')}</p>
        )}
        {account.engine === 'helena' && enabled.has('mail') && (
          <MailboxWindowField value={window} onChange={setWindow} />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            {tCommon('cancel')}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={update.isPending || saveMailbox.isPending}
          >
            {tCommon('save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
