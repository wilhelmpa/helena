'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { twoFactor, useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AccountSecurityTotpEnrollDialog from './AccountSecurityTotpEnrollDialog';

// TOTP: the step-up factor the owner terminal asks for (Home -> Terminal), until
// this instance is behind HTTPS and a passkey can do it instead (WebAuthn needs a
// secure context). Enrolling here is also what apps/api/src/modules/owner-terminal
// verifies against -- there is no separate "owner terminal" secret.
export default function AccountSecurityTotpSection() {
  const t = useTranslations('account.security');
  const { data: session, refetch } = useSession();
  const enabled = Boolean(
    (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );
  const [password, setPassword] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  async function disable() {
    const { error } = await twoFactor.disable({ password: password || undefined });
    if (error) {
      toast.error(t('totpDisableFailed'));
      return;
    }
    toast.success(t('totpDisabled'));
    setPassword('');
    await refetch();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">{enabled ? t('totpStatusEnabled') : t('totpStatusDisabled')}</p>
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="account-totp-password">{t('totpPasswordLabel')}</Label>
        <Input
          id="account-totp-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('totpPasswordHint')}</p>
      </div>
      {enabled ? (
        <Button variant="outline" size="sm" onClick={() => void disable()}>
          {t('totpDisable')}
        </Button>
      ) : (
        <Button size="sm" onClick={() => setEnrolling(true)}>
          {t('totpEnable')}
        </Button>
      )}
      {enrolling && (
        <AccountSecurityTotpEnrollDialog
          password={password}
          onClose={() => setEnrolling(false)}
          onEnabled={async () => {
            setEnrolling(false);
            setPassword('');
            await refetch();
          }}
        />
      )}
    </div>
  );
}
