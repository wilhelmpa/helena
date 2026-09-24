'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/core/client';
import { useStepUpWithTotp } from '../services/owner-terminal.service';

// The step-up the owner terminal requires before it opens, every time, even on
// the LAN (see docs/volition-design-owner-terminals.md §2): a live TOTP code,
// enrolled once at Account -> Security. Passkey step-up needs a secure context,
// which this instance does not have until Cloudflare Access is in front of it, so
// this is the only method offered today.
export default function StepUpDialog({ onSuccess }: { onSuccess: () => void }) {
  const t = useTranslations('ownerTerminal.stepUp');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stepUp = useStepUpWithTotp();

  async function submit() {
    setError(null);
    try {
      await stepUp.mutateAsync(code);
      setCode('');
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setError(t('rateLimited'));
      else setError(t('wrongCode'));
    }
  }

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-sm" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="owner-terminal-totp">{t('codeLabel')}</Label>
            <Input
              id="owner-terminal-totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={code.length !== 6 || stepUp.isPending}>
            {stepUp.isPending ? t('verifying') : t('confirm')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
