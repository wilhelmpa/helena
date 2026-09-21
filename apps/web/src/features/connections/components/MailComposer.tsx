import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { createMailDraft } from '@/lib/api/endpoints/connections';
import { useTranslations } from 'next-intl';

interface Props {
  account: string;
  reply?: { messageId?: string; threadId?: string; subject?: string };
  onCreated: () => void;
}

export default function MailComposer({ account, reply, onCreated }: Props) {
  const t = useTranslations('connections.mail');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(reply?.subject ? `Re: ${reply.subject}` : '');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      await createMailDraft({
        account,
        to: to
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        subject,
        body,
        replyToMessageId: reply?.messageId,
        threadId: reply?.threadId,
      });
      setBody('');
      setMessage(t('draftSaved'));
      onCreated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('errors.saveDraft'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-medium">{t('newDraft')}</h2>
      <label className="block text-sm">
        {t('to')}
        <input
          className="mt-1 w-full rounded border bg-background px-3 py-2"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="name@example.com"
        />
      </label>
      <label className="block text-sm">
        {t('subject')}
        <input
          className="mt-1 w-full rounded border bg-background px-3 py-2"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        {t('plainTextMessage')}
        <textarea
          className="mt-1 min-h-40 w-full rounded border bg-background px-3 py-2"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <div className="flex items-center gap-3">
        <Button disabled={busy || !to.trim() || !subject.trim()} onClick={save}>
          {t('saveDraft')}
        </Button>
        <span className="text-xs text-muted-foreground">{t('saveDoesNotSend')}</span>
      </div>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </section>
  );
}
