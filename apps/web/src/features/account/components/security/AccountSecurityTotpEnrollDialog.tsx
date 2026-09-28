'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { twoFactor } from '@/lib/auth-client';
import { copyText } from '@/utils/clipboard';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// No QR code: rendering one would need a new package (see the branch report for
// why that was not added). An authenticator app's "enter a setup key manually"
// option takes this secret directly, the same otpauth:// secret a QR would encode.
function secretFromUri(totpURI: string): string {
  return new URL(totpURI.replace('otpauth://', 'https://')).searchParams.get('secret') ?? '';
}

export default function AccountSecurityTotpEnrollDialog({
  password,
  onClose,
  onEnabled,
}: {
  password: string;
  onClose: () => void;
  onEnabled: () => void;
}) {
  const t = useTranslations('account.security');
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void twoFactor
      .enable({ password: password || undefined })
      .then(({ data, error: enableError }) => {
        if (cancelled) return;
        if (enableError || !data) {
          setError(t('totpEnrollFailed'));
          return;
        }
        setSecret(secretFromUri(data.totpURI));
      });
    return () => {
      cancelled = true;
    };
    // Runs once, when the dialog opens; password is a snapshot of the form field
    // at that moment, not a value this effect should re-run on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirm() {
    setError(null);
    const { error: verifyError } = await twoFactor.verifyTotp({ code });
    if (verifyError) {
      setError(t('totpConfirmFailed'));
      return;
    }
    toast.success(t('totpEnabled'));
    onEnabled();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="small">
        <DialogHeader>
          <DialogTitle>{t('totpEnrollTitle')}</DialogTitle>
        </DialogHeader>
        {secret ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            <div className="space-y-1.5">
              <Label>{t('totpSecretLabel')}</Label>
              <button
                type="button"
                className="block w-full truncate rounded-md border px-2 py-1.5 text-start font-mono text-xs"
                onClick={() => void copyText(secret)}
              >
                {secret}
              </button>
              <p className="text-xs text-muted-foreground">{t('totpSecretHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-totp-code">{t('totpCodeLabel')}</Label>
              <Input
                id="account-totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={code.length !== 6}>
              {t('totpConfirm')}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-destructive">{error ?? t('totpEnrollFailed')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
