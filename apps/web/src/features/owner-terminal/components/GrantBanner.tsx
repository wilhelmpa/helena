'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Text } from '@/design-system';
import { useRevokeOwnerTerminalGrant } from '../services/owner-terminal.service';

// "Freigegeben bis 08:14 · Beenden" (design §2): the grant is always visible while it is
// open and revocable in one click from here — a quiet line under the tabs, not a warning
// bar (owner, 28.09.: stays, but more discreet). No expiry means the owner turned the
// step-up off for the LAN: there is no grant to end, so it only says so.
export default function GrantBanner({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) {
    return <LanNote />;
  }
  // Keyed: a renewed grant starts fresh instead of carrying "expired" over.
  return <TimedGrant key={expiresAt} expiresAt={expiresAt} />;
}

function LanNote() {
  const t = useTranslations('ownerTerminal.grant');
  return (
    <div className="ds-terminal-grant">
      <Text size="xs" tone="faint">
        {t('lan')}
      </Text>
    </div>
  );
}

function TimedGrant({ expiresAt }: { expiresAt: string }) {
  const t = useTranslations('ownerTerminal.grant');
  const format = useFormatter();
  const revoke = useRevokeOwnerTerminalGrant();
  const [expired, setExpired] = useState(() => new Date(expiresAt).getTime() <= Date.now());

  useEffect(() => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return;
    const timer = setTimeout(() => setExpired(true), ms);
    return () => clearTimeout(timer);
  }, [expiresAt]);

  return (
    <div className="ds-terminal-grant">
      <Text size="xs" tone={expired ? 'warning' : 'faint'}>
        {expired
          ? t('expired')
          : t('active', {
              time: format.dateTime(new Date(expiresAt), { hour: '2-digit', minute: '2-digit' }),
            })}
      </Text>
      {!expired && (
        <button
          type="button"
          className="ds-terminal-grant-end"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate()}
        >
          {t('end')}
        </button>
      )}
    </div>
  );
}
