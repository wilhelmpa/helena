'use client';

import { useState } from 'react';
import { CloudUpload, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import StatusBadge from '@/components/common/page/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { BackupTarget } from '@/lib/api/endpoints/server';
import { formatDurationShort } from '@/utils/dates';
import { useRemoveBackupTarget, useSaveBackupTarget } from '../services/server.service';
import { CardHeader } from './ServerParts';

// Offsite targets (behind HELENA_BACKUP_REMOTE=1): every backup run copies its snapshot to an
// S3 bucket (restic copy, the same password). The key goes to the host helper, which keeps it
// root-only; Helena's database never holds it.
export default function BackupTargetsCard({ targets }: { targets: BackupTarget[] }) {
  const t = useTranslations('server.backup.targets');
  const save = useSaveBackupTarget();
  const remove = useRemoveBackupTarget();
  const [repository, setRepository] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const valid =
    /^s3:https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._/-]*)?$/.test(repository) &&
    accessKeyId.length >= 4 &&
    secretAccessKey.length >= 8;

  return (
    <section className="min-w-0 space-y-3 rounded-md border border-sidebar-border bg-card p-4">
      <CardHeader title={t('title')} />
      <p className="text-xs text-muted-foreground">{t('explain')}</p>
      {targets.length > 0 && (
        <ul className="space-y-1">
          {targets.map((target) => (
            <li key={target.id} className="flex min-w-0 items-center gap-2 text-sm">
              <StatusBadge
                status={!target.lastCopy ? 'idle' : target.lastCopy.ok ? 'success' : 'danger'}
                dotOnly
              />
              <span className="min-w-0 flex-1 truncate" dir="ltr">
                {target.repository}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {target.lastCopy ? formatDurationShort(target.lastCopy.at) : t('neverCopied')}
              </span>
              <Switch
                checked={target.enabled}
                aria-label={t('enabled')}
                onCheckedChange={(enabled) =>
                  save.mutate({ id: target.id, body: { repository: target.repository, enabled } })
                }
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t('remove')}
                onClick={() => remove.mutate(target.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {targets.length === 0 && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            save.mutate(
              {
                id: 'offsite',
                body: { repository, enabled: true, credentials: { accessKeyId, secretAccessKey } },
              },
              {
                onSuccess: () => {
                  setSecretAccessKey('');
                  toast.success(t('saved'));
                },
              },
            );
          }}
        >
          <Input
            value={repository}
            onChange={(event) => setRepository(event.target.value.trim())}
            placeholder="s3:https://s3.example.com/bucket/helena"
            dir="ltr"
            aria-label={t('repository')}
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              value={accessKeyId}
              onChange={(event) => setAccessKeyId(event.target.value.trim())}
              placeholder={t('accessKeyId')}
              autoComplete="off"
              dir="ltr"
              aria-label={t('accessKeyId')}
            />
            <Input
              type="password"
              value={secretAccessKey}
              onChange={(event) => setSecretAccessKey(event.target.value)}
              placeholder={t('secretAccessKey')}
              autoComplete="new-password"
              dir="ltr"
              aria-label={t('secretAccessKey')}
            />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={!valid || save.isPending}>
            <CloudUpload />
            {t('add')}
          </Button>
        </form>
      )}
    </section>
  );
}
