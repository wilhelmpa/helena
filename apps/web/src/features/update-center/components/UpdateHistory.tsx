'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RowEmpty, RowList, SectionLabel } from '@/components/common/page/RowList';
import StatusBadge, { type Status } from '@/components/common/page/StatusBadge';
import type { UpdateAction } from '@/lib/api/endpoints/updateCenter';
import { formatDateTime } from '@/utils/dates';

const STATE_STATUS: Record<UpdateAction['state'], Status> = {
  running: 'running',
  done: 'success',
  failed: 'danger',
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

// The updates the owner started, newest first: what, from which version to which, how it
// went; opened, the helper's log, the database dump, the way back and the services after.
export default function UpdateHistory({ actions }: { actions: UpdateAction[] }) {
  const t = useTranslations('updates');
  return (
    <section className="min-w-0">
      <SectionLabel>{t('history')}</SectionLabel>
      <RowList className="bg-card">
        {actions.length === 0 ? (
          <RowEmpty>{t('noHistory')}</RowEmpty>
        ) : (
          actions.map((action) => <HistoryRow key={action.id} action={action} />)
        )}
      </RowList>
    </section>
  );
}

// An update that is running, or ended in the last ten minutes, opens with its log.
const RECENT_MS = 10 * 60_000;

function HistoryRow({ action }: { action: UpdateAction }) {
  const t = useTranslations('updates');
  const [openAtFirst] = useState(
    () =>
      action.state === 'running' ||
      (action.finishedAt !== null && Date.now() - Date.parse(action.finishedAt) < RECENT_MS),
  );
  const result = action.result ?? {};
  const rollback =
    typeof result.rollback === 'string' && result.rollback.trim() ? result.rollback : null;
  const failedUnits = strings(result.failedUnits);
  const services = Array.isArray(action.health?.services)
    ? (action.health.services as { service: string; state: string }[])
    : [];
  const step =
    action.fromVersion || action.toVersion
      ? `${action.fromVersion ?? '–'} → ${action.toVersion ?? '–'}`
      : action.components.join(', ');
  return (
    <details open={openAtFirst} className="group rounded-md px-2 text-sm open:bg-sidebar-accent/40">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 shrink truncate" dir="auto">
          {action.name}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" dir="ltr">
          {step}
        </span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {formatDateTime(action.requestedAt)}
        </span>
        <StatusBadge status={STATE_STATUS[action.state]}>{t(`action.${action.state}`)}</StatusBadge>
      </summary>
      <div className="space-y-2 pb-3 text-xs">
        {action.error && (
          <p className="text-status-danger" dir="auto">
            {action.error}
          </p>
        )}
        {action.backupPath && (
          <p className="text-muted-foreground" dir="auto">
            {t('action.backup', { path: action.backupPath })}
          </p>
        )}
        {rollback && (
          <p className="font-mono break-all text-muted-foreground" dir="ltr">
            {t('action.rollback', { command: rollback })}
          </p>
        )}
        {failedUnits.length > 0 && (
          <p className="text-status-danger">
            {t('action.failedUnits', { units: failedUnits.join(', ') })}
          </p>
        )}
        {result.rebootRequired === true && (
          <p className="text-status-waiting">{t('action.reboot')}</p>
        )}
        {services.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-muted-foreground">{t('action.services')}</span>
            {services.map((service) => (
              <StatusBadge
                key={service.service}
                status={
                  service.state === 'ok' ? 'success' : service.state === 'down' ? 'danger' : 'idle'
                }
              >
                {service.service}
              </StatusBadge>
            ))}
          </p>
        )}
        {action.log && (
          <div className="space-y-1">
            <span className="text-muted-foreground">{t('action.log')}</span>
            <pre
              className="max-h-64 overflow-auto rounded-md border border-sidebar-border bg-background p-2 font-mono text-xs leading-snug whitespace-pre-wrap"
              dir="ltr"
            >
              {action.log}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}
