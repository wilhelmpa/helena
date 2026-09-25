'use client';

import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import StatusBadge from '@/components/common/page/StatusBadge';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { formatDateTime } from '@/utils/dates';
import type { SignInEvent } from '@/lib/api/endpoints/security';
import { byKey } from '@/utils/messageKey';
import { useSignInEventsQuery } from '../services/security.service';

// The reasons packages/auth edge-sign-in.ts writes for a refusal; one this build does not
// know shows as it is.
const REASONS = [
  'disabled',
  'not_configured',
  'missing_assertion',
  'invalid_assertion',
  'identity_not_allowed',
  'no_account',
  'not_eligible',
  'deactivated',
] as const;

// The sign-ins Helena opened without a password, newest first: through the Cloudflare
// sign-in (with the identity Access signed) and the LAN owner sign-in at home, refused ones
// too. Who came in how, and from where.
export default function SignInEventsList() {
  const t = useTranslations('serverSecurity.signIns');
  const events = useSignInEventsQuery();
  const reason = (event: SignInEvent) =>
    event.reason && (REASONS as readonly string[]).includes(event.reason)
      ? byKey(t)(`reason.${event.reason}`)
      : (event.reason ?? '');

  if (events.isPending) return <ListSkeleton rows={4} rowClassName="h-8" />;
  const rows = events.data ?? [];
  if (rows.length === 0) {
    return <SettingsCard className="p-4 text-sm text-muted-foreground">{t('empty')}</SettingsCard>;
  }
  return (
    <SettingsCard className="divide-y p-0">
      {rows.map((event) => (
        <div key={event.id} className="flex min-h-8 items-center gap-3 px-3 py-1 text-xs">
          <StatusBadge status={event.outcome === 'ok' ? 'success' : 'danger'} dotOnly />
          <span className="w-36 shrink-0 font-mono text-muted-foreground tabular-nums max-sm:hidden">
            {formatDateTime(event.createdAt)}
          </span>
          <span className="w-28 shrink-0 truncate">
            {event.method === 'edge' ? t('methodEdge') : t('methodLocalOwner')}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {event.outcome === 'ok'
              ? (event.identity ?? event.userName ?? '')
              : `${t('refused')}: ${reason(event)}${event.identity ? ` · ${event.identity}` : ''}`}
          </span>
          <span className="w-32 shrink-0 truncate text-end font-mono text-muted-foreground max-md:hidden">
            {event.ipAddress ?? ''}
          </span>
        </div>
      ))}
    </SettingsCard>
  );
}
