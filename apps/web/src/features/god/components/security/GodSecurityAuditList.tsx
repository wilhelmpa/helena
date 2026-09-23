'use client';

import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { OwnerTerminalAuditEntry } from '@/lib/api/endpoints/owner-terminal';

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

  if (isPending) return <ListSkeleton rows={5} rowClassName="h-8" />;
  if (entries.length === 0) {
    return <SettingsCard className="p-4 text-sm text-muted-foreground">{t('auditEmpty')}</SettingsCard>;
  }

  return (
    <SettingsCard className="divide-y p-0">
      {entries.map((entry) => (
        <div key={entry.id} className="flex h-8 items-center gap-3 px-3 text-xs">
          <span className="w-40 shrink-0 font-mono text-muted-foreground">
            {new Date(entry.createdAt).toLocaleString()}
          </span>
          <span className="w-32 shrink-0">{tEvent(entry.event)}</span>
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
