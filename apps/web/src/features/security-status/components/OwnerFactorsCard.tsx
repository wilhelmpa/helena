'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import StatusBadge from '@/components/common/page/StatusBadge';
import type { SecurityStatus } from '@/lib/api/endpoints/security';

// What has to be true before the instance goes onto the internet (see the go-live list
// in docs/helena-decisions/security-hardening.md): a second factor for the owner, the
// code before the terminal opens, and no pile of old sessions.
export default function OwnerFactorsCard({ owner }: { owner: SecurityStatus['owner'] }) {
  const t = useTranslations('serverSecurity.owner');
  const rows = [
    { key: 'totp', ok: owner.totp, text: owner.totp ? t('totpOn') : t('totpOff') },
    { key: 'passkey', ok: owner.passkey, text: owner.passkey ? t('passkeyOn') : t('passkeyOff') },
    {
      key: 'stepUp',
      ok: owner.stepUpRequired,
      text: owner.stepUpRequired ? t('stepUpOn') : t('stepUpOff'),
    },
    {
      key: 'sessions',
      ok: owner.activeSessions <= 50,
      text: t('sessions', { count: owner.activeSessions }),
    },
  ];
  return (
    <SettingsCard className="divide-y p-0">
      {rows.map((row) => (
        <div key={row.key} className="flex h-8 items-center gap-2 px-3 text-sm">
          <StatusBadge status={row.ok ? 'success' : 'waiting'} dotOnly />
          <span className="min-w-0 truncate">{row.text}</span>
        </div>
      ))}
      {!(owner.totp && owner.passkey) && (
        <div className="px-3 py-2 text-xs">
          <Link href="/account/security" className="underline underline-offset-2">
            {t('setUp')}
          </Link>
        </div>
      )}
    </SettingsCard>
  );
}
