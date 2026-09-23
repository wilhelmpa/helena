import { useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CredentialEntry } from '@/lib/api/endpoints/credentials';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useRegenerateSshKey } from '@/services/credentials.service';
import { copyText } from '@/utils/clipboard';

// The public key of an SSH key, to add where the agent signs in. The private key stays in
// Plan.
export function CredentialSshKey({
  teamId,
  entry,
  onChange,
}: {
  teamId: number;
  entry: CredentialEntry;
  onChange: (entry: CredentialEntry) => void;
}) {
  const t = useTranslations('credentials.ssh');
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const regenerate = useRegenerateSshKey(teamId);

  async function copy() {
    try {
      await copyText(entry.publicKey ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The browser can refuse the clipboard; the key can still be selected.
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">{t('publicKey')}</div>
      <div className="flex items-start gap-2">
        <p
          dir="ltr"
          className="min-w-0 flex-1 rounded-md bg-muted/40 px-3 py-2 font-mono text-xs break-all select-all"
        >
          {entry.publicKey}
        </p>
        <Button type="button" variant="outline" size="icon" title={t('copy')} onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t('publicKeyHint')}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={regenerate.isPending}
          onClick={() => setConfirming(true)}
        >
          <RefreshCw className="size-3.5" />
          {t('regenerate')}
        </Button>
      </div>
      {confirming && (
        <ConfirmDialog
          title={t('regenerate')}
          confirmLabel={t('regenerate')}
          onConfirm={async () => {
            onChange(await regenerate.mutateAsync(entry.id));
            setConfirming(false);
          }}
          onClose={() => setConfirming(false)}
        >
          <div className="text-sm text-muted-foreground">{t('regenerateConfirm')}</div>
        </ConfirmDialog>
      )}
    </div>
  );
}
