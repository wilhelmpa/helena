'use client';

import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { OwnerTerminalAuditEntry } from '@/lib/api/endpoints/owner-terminal';

// The event names the api's audit rows use (owner_terminal_audit_event_check in
// packages/db/src/schema/app.ts). A plain string column, so this maps each known
// value to its translated label and falls back to the raw value for one this
// build does not know yet, rather than widening the DTO to a literal union only
// to cast it back for display.
const EVENT_KEYS = [
  'step_up_ok',
  'step_up_fail',
  'rate_limited',
  'grant_revoked',
  'session_start',
  'session_end',
  'token_rejected',
] as const;

// Newest first, no keystrokes ever shown here (see design §2.4: recording, when a
// session kind opts into it, goes to a root-readable file on the host, not this
// list). `detail` stays reserved for a future failure reason; nothing writes it yet.
export default function GodSecurityAuditList({
  entries,
  isPending,
}: {
  entries: OwnerTerminalAuditEntry[];
  isPending: boolean;
}) {
  const t = useTranslations('god.security');
  const tEvent = useTranslations('god.security.event');
  const eventLabel = (event: string): string =>
    (EVENT_KEYS as readonly string[]).includes(event)
      ? tEvent(event as (typeof EVENT_KEYS)[number])
      : event;

  if (isPending) return <ListSkeleton rows={5} rowClassName="h-8" />;
  if (entries.length === 0) {
    return (
      <SettingsCard className="p-4 text-sm text-muted-foreground">{t('auditEmpty')}</SettingsCard>
    );
  }

  return (
    <SettingsCard className="divide-y p-0">
      {entries.map((entry) => (
        <div key={entry.id} className="flex h-8 items-center gap-3 px-3 text-xs">
          <span className="w-40 shrink-0 font-mono text-muted-foreground">
            {new Date(entry.createdAt).toLocaleString()}
          </span>
          <span className="w-32 shrink-0">{eventLabel(entry.event)}</span>
          <span className="w-32 shrink-0 text-muted-foreground">{entry.kind ?? ''}</span>
          <span className="flex-1 truncate text-muted-foreground">{entry.device ?? ''}</span>
          <span className="w-28 shrink-0 text-end font-mono text-muted-foreground">
            {entry.ipAddress ?? ''}
          </span>
        </div>
      ))}
    </SettingsCard>
  );
}
