'use client';

import { useState } from 'react';
import { Eye, KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import CopyableCommand from '@/components/common/page/CopyableCommand';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useAcknowledgeBackupPassword, useRevealBackupPassword } from '../services/server.service';
import { CardHeader } from './ServerParts';

// The backup's password, shown until the owner confirms he wrote it down. Without it the
// backup cannot be read, also not by a new Helena after a reinstall; after the confirmation
// Helena never shows it again (root can still read it on the machine). The password lives in
// this card's state only, never in a cache.
export default function BackupPasswordCard() {
  const t = useTranslations('server.backup.password');
  const tCommon = useTranslations('common');
  const reveal = useRevealBackupPassword();
  const acknowledge = useAcknowledgeBackupPassword();
  const [password, setPassword] = useState<string | null>(null);
  const [written, setWritten] = useState(false);

  return (
    <section className="min-w-0 space-y-3 rounded-md border border-status-waiting/50 bg-card p-4 xl:col-span-2">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <KeyRound className="size-4 text-status-waiting" />
            {t('title')}
          </span>
        }
      />
      <p className="text-sm">{t('explain')}</p>
      {password === null ? (
        <Button
          variant="outline"
          size="sm"
          disabled={reveal.isPending}
          onClick={() =>
            reveal.mutate(undefined, { onSuccess: (value) => setPassword(value.password) })
          }
        >
          <Eye />
          {t('show')}
        </Button>
      ) : (
        <div className="max-w-xl space-y-3">
          <CopyableCommand
            command={password}
            copyLabel={tCommon('copy')}
            copiedLabel={tCommon('copied')}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={written} onCheckedChange={(value) => setWritten(value === true)} />
            {t('written')}
          </label>
          <Button
            size="sm"
            disabled={!written || acknowledge.isPending}
            onClick={() =>
              acknowledge.mutate(undefined, {
                onSuccess: () => {
                  setPassword(null);
                  toast.success(t('confirmed'));
                },
              })
            }
          >
            {t('confirm')}
          </Button>
        </div>
      )}
    </section>
  );
}
