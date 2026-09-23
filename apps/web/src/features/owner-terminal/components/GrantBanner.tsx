'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useRevokeOwnerTerminalGrant } from '../services/owner-terminal.service';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// "Terminal freigegeben bis 08:14 · Beenden" (design §2): the grant is always
// visible while it is open, and always revocable in one click from here, not
// just from Home -> Security. No expiry means the owner turned the step-up off
// for the LAN (Administrator -> Sicherheit): there is no grant to end, so the
// banner only says so.
export default function GrantBanner({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return <LanBanner />;
  return <TimedGrantBanner expiresAt={expiresAt} />;
}

function LanBanner() {
  const t = useTranslations('ownerTerminal.grant');
  return (
    <div className="flex h-8 shrink-0 items-center border-b px-3 text-xs text-muted-foreground">
      {t('lan')}
    </div>
  );
}

function TimedGrantBanner({ expiresAt }: { expiresAt: string }) {
  const t = useTranslations('ownerTerminal.grant');
  const revoke = useRevokeOwnerTerminalGrant();
  const [expired, setExpired] = useState(() => new Date(expiresAt).getTime() <= Date.now());

  useEffect(() => {
    setExpired(false);
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) {
      setExpired(true);
      return;
    }
    const timer = setTimeout(() => setExpired(true), ms);
    return () => clearTimeout(timer);
  }, [expiresAt]);

  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-b bg-warning/10 px-3 text-xs">
      <span>{expired ? t('expired') : t('active', { time: formatTime(expiresAt) })}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        disabled={revoke.isPending}
        onClick={() => revoke.mutate()}
      >
        {t('end')}
      </Button>
    </div>
  );
}
