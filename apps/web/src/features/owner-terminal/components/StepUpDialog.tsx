'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { stepUpFailure } from '../utils/stepUpFailure';
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
  // The X (or Escape) closes the question instead of trapping the owner in it (owner,
  // 2026-09-24); the terminal then shows that it is locked, with a way back to the code.
  const [open, setOpen] = useState(true);
  const stepUp = useStepUpWithTotp();

  async function submit() {
    setError(null);
    try {
      await stepUp.mutateAsync(code);
      setCode('');
      onSuccess();
    } catch (err) {
      setError(t(stepUpFailure(err)));
    }
  }

  if (!open) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Lock className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="max-w-xs text-sm text-muted-foreground">{t('locked')}</p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          {t('enterCode')}
        </Button>
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={setOpen}>
      <DialogContent size="small" onInteractOutside={(event) => event.preventDefault()}>
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
