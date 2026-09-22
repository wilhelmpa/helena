'use client';

import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  ServerCog,
  ShieldCheck,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import {
  getConnections,
  getSecretInventory,
  getVaultStatus,
  type VaultStatus,
} from '@/lib/api/endpoints/connections';
import { cn } from '@/lib/utils';

function StatusBadge({ status }: { status: VaultStatus['accessStatus'] }) {
  const t = useTranslations('connections.vault.status');
  const positive = status === 'protected' || status === 'reachable';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        positive
          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
      )}
    >
      {positive ? <CheckCircle2 className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
      {t(status)}
    </span>
  );
}

export default function VaultPage() {
  const t = useTranslations('connections.vault');
  const connectionsT = useTranslations('connections');
  const status = useQuery({ queryKey: ['vault', 'status'], queryFn: getVaultStatus });
  const connections = useQuery({
    queryKey: ['connections'],
    queryFn: getConnections,
    refetchInterval: 60_000,
  });
  const grants = useQuery({
    queryKey: ['connections', 'secrets'],
    queryFn: getSecretInventory,
  });
  const failed = status.isError || grants.isError;

  return (
    <Shell globalHome globalTitle={t('title')} autoOpenGlobalChat={false}>
      <div className="h-full overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-5xl space-y-5">
          <div>
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
          </div>

          {failed ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {t('loadError')}
            </p>
          ) : null}

          <section className="rounded-lg border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                  <KeyRound className="size-5" />
                </span>
                <div>
                  <h2 className="font-semibold">{t('accessTitle')}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t('accessDescription')}</p>
                </div>
              </div>
              {status.data ? <StatusBadge status={status.data.accessStatus} /> : null}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">{t('statusScope')}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {status.data?.accessUrl ? (
                <Button asChild>
                  <a href={status.data.accessUrl} target="_blank" rel="noopener noreferrer">
                    {t('open')}
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              ) : null}
              {status.data ? (
                <span className="text-xs text-muted-foreground">
                  {t('checked', { time: new Date(status.data.checkedAt).toLocaleString() })}
                </span>
              ) : null}
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-card p-5">
              <LockKeyhole className="size-5 text-muted-foreground" />
              <h2 className="mt-3 font-semibold">{t('humanVault')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('humanVaultDescription')}</p>
            </div>
            <div className="rounded-lg border bg-card p-5">
              <ServerCog className="size-5 text-muted-foreground" />
              <h2 className="mt-3 font-semibold">{t('automationVault')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('automationVaultDescription')}
              </p>
            </div>
          </section>
          <p className="rounded-md border border-blue-500/20 bg-blue-500/5 p-3 text-sm">
            {t('boundaryRule')}
          </p>

          <section className="rounded-lg border bg-card p-5">
            <h2 className="font-semibold">{t('connectionsTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('connectionsDescription')}</p>
            {connections.isError ? (
              <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {connectionsT('loadError')}
              </p>
            ) : null}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {(connections.data?.items ?? []).map((connection) => (
                <div
                  key={connection.id}
                  className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2"
                >
                  <span className="truncate text-sm font-medium">{connection.label}</span>
                  <span className="ms-3 shrink-0 text-xs text-muted-foreground">
                    {connection.status}
                  </span>
                </div>
              ))}
            </div>
            {!connections.isError && connections.data?.items.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">{t('noConnections')}</p>
            ) : null}
          </section>

          <section className="rounded-lg border bg-card p-5">
            <h2 className="font-semibold">{t('grantsTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('grantsDescription')}</p>
            <div className="mt-4 space-y-2">
              {(grants.data?.entries ?? []).map((entry) => (
                <div key={entry.name} className="rounded-md border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="text-xs font-medium">{entry.name}</code>
                    <span className="text-xs text-muted-foreground">
                      {entry.updatedAt
                        ? t('updated', { time: new Date(entry.updatedAt).toLocaleString() })
                        : t('never')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('allowedHosts')}: {entry.allowedHosts.join(', ') || '—'}
                  </p>
                </div>
              ))}
            </div>
            {grants.data?.entries.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">{t('noGrants')}</p>
            ) : null}
          </section>
        </div>
      </div>
    </Shell>
  );
}
