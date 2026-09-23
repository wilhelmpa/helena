'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import {
  downloadMailAttachment,
  getMailAccounts,
  getMailLabels,
  getMailThread,
  modifyMailLabels,
  searchMail,
  type MailAccountStatus,
  type MailPayload,
} from '@/lib/api/endpoints/connections';
import MailComposer from './components/MailComposer';
import MailToolbar from './components/MailToolbar';
import { mailAttachments, mailRows, safeMailText } from './utils/mailPayload';

export default function MailContent() {
  const t = useTranslations('connections');
  const [accounts, setAccounts] = useState<MailAccountStatus[]>([]);
  const [account, setAccount] = useState('');
  const [query, setQuery] = useState('in:inbox');
  const [results, setResults] = useState<MailPayload>();
  const [thread, setThread] = useState<MailPayload>();
  const [threadId, setThreadId] = useState('');
  const [labels, setLabels] = useState<MailPayload>();
  const [labelInput, setLabelInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accountRef = useRef('');
  const operationRef = useRef(0);
  const statusLabels: Record<MailAccountStatus['status'], string> = {
    connected: t('status.connected'),
    available: t('status.available'),
    configured: t('status.configured'),
    disabled: t('status.disabled'),
    unavailable: t('status.unavailable'),
    unsupported: t('status.unsupported'),
    error: t('status.error'),
  };

  useEffect(() => {
    let active = true;
    void getMailAccounts()
      .then((data) => {
        if (!active) return;
        setAccounts(data.accounts);
        const selected =
          accountRef.current ||
          data.accounts.find((item) => item.status === 'connected')?.account ||
          data.accounts[0]?.account ||
          '';
        accountRef.current = selected;
        setAccount(selected);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : t('mail.errors.accounts')),
      );
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    if (!account) return;
    let active = true;
    const selected = account;
    void getMailLabels(selected)
      .then((value) => {
        if (active && accountRef.current === selected) setLabels(value);
      })
      .catch(() => {
        if (active && accountRef.current === selected) setLabels(undefined);
      });
    return () => {
      active = false;
    };
  }, [account]);

  const selectAccount = (selected: string) => {
    operationRef.current += 1;
    accountRef.current = selected;
    setAccount(selected);
    setResults(undefined);
    setThread(undefined);
    setThreadId('');
    setLabels(undefined);
    setLabelInput('');
    setError('');
    setBusy(false);
  };

  const search = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!account) return;
    const selected = account;
    const operation = ++operationRef.current;
    setBusy(true);
    setError('');
    try {
      const value = await searchMail({ account: selected, query, maxResults: 30 });
      if (accountRef.current !== selected || operationRef.current !== operation) return;
      setResults(value);
      setThread(undefined);
      setThreadId('');
    } catch (caught) {
      if (operationRef.current === operation)
        setError(caught instanceof Error ? caught.message : t('mail.errors.search'));
    } finally {
      if (operationRef.current === operation) setBusy(false);
    }
  };

  const openThread = async (id: string) => {
    const selected = account;
    const operation = ++operationRef.current;
    setBusy(true);
    setError('');
    try {
      const value = await getMailThread({ account: selected, threadId: id });
      if (accountRef.current !== selected || operationRef.current !== operation) return;
      setThread(value);
      setThreadId(id);
    } catch (caught) {
      if (operationRef.current === operation)
        setError(caught instanceof Error ? caught.message : t('mail.errors.thread'));
    } finally {
      if (operationRef.current === operation) setBusy(false);
    }
  };

  const addLabel = async () => {
    const add = labelInput
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!threadId || !add.length) return;
    const selected = account;
    const selectedThread = threadId;
    const operation = ++operationRef.current;
    setBusy(true);
    try {
      await modifyMailLabels({ account: selected, threadId: selectedThread, add });
      if (accountRef.current !== selected || operationRef.current !== operation) return;
      setLabelInput('');
      const value = await getMailThread({ account: selected, threadId: selectedThread });
      if (accountRef.current === selected && operationRef.current === operation) setThread(value);
    } catch (caught) {
      if (operationRef.current === operation)
        setError(caught instanceof Error ? caught.message : t('mail.errors.labels'));
    } finally {
      if (operationRef.current === operation) setBusy(false);
    }
  };

  return (
    <div className="@container h-full overflow-auto p-4 md:p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">{t('mail.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('mail.description')}</p>
      </header>
      {error ? (
        <p className="mb-4 rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <MailToolbar
        accounts={accounts}
        account={account}
        query={query}
        busy={busy}
        statusLabels={statusLabels}
        searchLabel={t('mail.search')}
        searchPlaceholder={t('mail.searchPlaceholder')}
        onAccountChange={selectAccount}
        onQueryChange={setQuery}
        onSearch={search}
      />
      <div className="grid min-h-96 gap-4 @[42rem]:grid-cols-[minmax(14rem,0.7fr)_minmax(20rem,1.3fr)] @[76rem]:grid-cols-[minmax(14rem,0.7fr)_minmax(20rem,1.3fr)_minmax(20rem,1fr)]">
        <section className="rounded-lg border">
          <h2 className="border-b p-3 font-medium">{t('mail.threads')}</h2>
          <div className="divide-y">
            {mailRows(results, t('mail.noSubject')).map((row) => (
              <button
                key={row.id}
                type="button"
                className="block w-full p-3 text-start hover:bg-muted/50"
                onClick={() => openThread(row.id)}
              >
                <p className="truncate text-sm font-medium">{row.subject}</p>
                <p className="truncate text-xs text-muted-foreground">{row.sender}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.snippet}</p>
              </button>
            ))}
          </div>
        </section>
        <section className="rounded-lg border p-4">
          {thread ? (
            <>
              <div className="mb-3 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm"
                  value={labelInput}
                  onChange={(event) => setLabelInput(event.target.value)}
                  placeholder={t('mail.labelPlaceholder')}
                />
                <Button size="sm" variant="outline" disabled={busy} onClick={addLabel}>
                  {t('mail.addLabel')}
                </Button>
              </div>
              <details className="mb-3 text-xs text-muted-foreground">
                <summary>{t('mail.availableLabels')}</summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap" dir="ltr">
                  {safeMailText(labels)}
                </pre>
              </details>
              <pre className="max-h-[36rem] overflow-auto rounded bg-muted/30 p-3 text-sm break-words whitespace-pre-wrap">
                {safeMailText(thread)}
              </pre>
              <div className="mt-3 flex flex-wrap gap-2">
                {mailAttachments(thread).map((item) => (
                  <Button
                    key={`${item.messageId}:${item.attachmentId}`}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const selected = account;
                      void downloadMailAttachment({ account: selected, ...item }).catch(
                        (caught) => {
                          if (accountRef.current === selected)
                            setError(
                              caught instanceof Error
                                ? caught.message
                                : t('mail.errors.attachment'),
                            );
                        },
                      );
                    }}
                  >
                    {item.filename}
                    {item.size ? ` (${Math.ceil(item.size / 1024)} KiB)` : ''}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('mail.selectThread')}</p>
          )}
        </section>
        {account ? <MailComposer account={account} onSent={() => void search()} /> : null}
      </div>
    </div>
  );
}
