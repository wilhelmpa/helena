'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSecretInventory, setSecret } from '@/lib/api/endpoints/connections';

const key = ['connections', 'secret-metadata'] as const;

export default function SecretStorePanel() {
  const t = useTranslations('connections.secrets');
  const client = useQueryClient();
  const inventory = useQuery({ queryKey: key, queryFn: getSecretInventory });
  const [name, setName] = useState('');
  const [hosts, setHosts] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<'saved' | 'failed' | null>(null);
  const existing = inventory.data?.entries.some((entry) => entry.name === name);

  return (
    <section className="mt-6 rounded-lg border p-4">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      {inventory.error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {t('failed')}
        </p>
      ) : null}
      <div className="mt-4 max-h-60 overflow-auto rounded border">
        {inventory.data?.entries.map((entry) => (
          <button
            key={entry.name}
            type="button"
            className="flex w-full items-start justify-between gap-3 border-b p-2 text-left text-sm last:border-0 hover:bg-accent"
            onClick={() => {
              setName(entry.name);
              setHosts(entry.allowedHosts.join(', '));
              setResult(null);
            }}
          >
            <span className="min-w-0 font-mono break-all">{entry.name}</span>
            <span className="max-w-48 text-right text-xs text-muted-foreground">
              {entry.allowedHosts.join(', ') || t('noHosts')}
            </span>
          </button>
        ))}
        {!inventory.isPending && inventory.data?.entries.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{t('empty')}</p>
        ) : null}
      </div>
      <form
        className="mt-4 grid gap-3"
        autoComplete="off"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          const form = event.currentTarget;
          const field = form.elements.namedItem('secret-value') as HTMLInputElement;
          const value = field.value;
          field.value = '';
          setPending(true);
          setResult(null);
          try {
            const data = await setSecret({
              name,
              value,
              allowedHosts: hosts
                .split(',')
                .map((host) => host.trim().toLowerCase())
                .filter(Boolean),
            });
            client.setQueryData(key, data);
            setResult('saved');
          } catch {
            setResult('failed');
          } finally {
            setPending(false);
          }
        }}
      >
        <label className="grid gap-1 text-sm">
          {t('name')}
          <Input
            required
            value={name}
            onChange={(event) => {
              setName(event.target.value.toUpperCase());
              setResult(null);
            }}
            pattern="[A-Z][A-Z0-9_]{2,127}"
            maxLength={128}
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t('value')}
          <Input
            name="secret-value"
            required
            type="password"
            maxLength={16384}
            autoComplete="new-password"
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t('hosts')}
          <Input
            value={hosts}
            onChange={(event) => setHosts(event.target.value)}
            placeholder="api.example.com"
          />
        </label>
        {existing ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">{t('rotateNotice')}</p>
        ) : null}
        <div>
          <Button type="submit" disabled={pending || inventory.isPending || !!inventory.error}>
            {pending ? t('saving') : existing ? t('rotate') : t('save')}
          </Button>
        </div>
        {result ? (
          <p
            role={result === 'failed' ? 'alert' : 'status'}
            className={
              result === 'failed' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
            }
          >
            {t(result)}
          </p>
        ) : null}
      </form>
    </section>
  );
}
