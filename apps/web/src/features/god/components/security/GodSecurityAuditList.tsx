'use client';

import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import { formatDateTime } from '@/utils/dates';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { OwnerTerminalAuditEntry } from '@/lib/api/endpoints/owner-terminal';

import { Box, Inline, Text } from '@/design-system';

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
      <SettingsCard>
        <Box pad={4}>
          <Text as="span" size="sm" tone="muted">
            {t('auditEmpty')}
          </Text>
        </Box>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard className="divide-y">
      {entries.map((entry) => (
        <Inline gap={3} padX={3} key={entry.id} className="flex h-8 items-center text-xs">
          <Text as="span" tone="muted" className="w-36 shrink-0 font-mono tabular-nums">
            {formatDateTime(entry.createdAt)}
          </Text>
          <span className="min-w-0 flex-1 truncate sm:w-32 sm:flex-none">
            {eventLabel(entry.event)}
          </span>
          <Text as="span" tone="muted" className="w-20 shrink-0 truncate max-md:hidden">
            {entry.kind ?? ''}
          </Text>
          <Text as="span" tone="muted" className="min-w-0 flex-1 truncate max-lg:hidden">
            {entry.device ?? ''}
          </Text>
          <Text as="span" tone="muted" className="w-28 shrink-0 text-end font-mono max-sm:hidden">
            {entry.ipAddress ?? ''}
          </Text>
        </Inline>
      ))}
    </SettingsCard>
  );
}
