import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import {
  authorizeMailSend,
  listMailDrafts,
  sendMailDraft,
  type MailPayload,
} from '@/lib/api/endpoints/connections';
import { draftIds } from '../utils/mailPayload';

export default function MailDrafts({ account, refresh }: { account: string; refresh: number }) {
  const t = useTranslations('connections.mail');
  const [payload, setPayload] = useState<MailPayload>();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void listMailDrafts(account)
      .then(setPayload)
      .catch((error) => setMessage(error instanceof Error ? error.message : t('errors.drafts')));
  }, [account, refresh, t]);

  const send = async (draftId: string) => {
    setBusy(draftId);
    setMessage('');
    try {
      const authorization = await authorizeMailSend(account, draftId);
      const confirmed = window.confirm(t('confirmSend'));
      if (!confirmed) {
        setMessage(t('sendCancelled'));
        return;
      }
      await sendMailDraft(account, draftId, authorization.confirmationToken);
      setMessage(t('draftSent'));
      setPayload(await listMailDrafts(account));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('errors.sendDraft'));
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="rounded-lg border p-4">
      <h2 className="font-medium">{t('savedDrafts')}</h2>
      <div className="mt-3 space-y-2">
        {draftIds(payload).map((id) => (
          <div
            key={id}
            className="flex items-center justify-between rounded border px-3 py-2 text-sm"
          >
            <code className="truncate">{id}</code>
            <Button
              size="sm"
              variant="destructive"
              disabled={Boolean(busy)}
              onClick={() => send(id)}
            >
              {t('reviewAndSend')}
            </Button>
          </div>
        ))}
        {draftIds(payload).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noDrafts')}</p>
        ) : null}
      </div>
      {message ? <p className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
    </section>
  );
}
