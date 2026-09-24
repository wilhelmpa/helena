'use client';

import { useState } from 'react';
import { KeyRound, Trash2, Webhook } from 'lucide-react';
import { useTranslations } from 'next-intl';
import CopyableValue from '@/components/common/page/CopyableValue';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { API_URL } from '@/lib/api/core/client';
import { usePipelineHook, usePipelineHookControl } from '@/services/engine.service';
import { formatDateTime } from '@/utils/dates';

// The address a sender posts to for a workflow with a webhook trigger, in this project.
// Its secret is shown once, when the address is created or given a new secret; a sender
// signs with it per Standard Webhooks or sends it as a bearer token.
export default function PipelineHookPanel({
  projectKey,
  pipelineId,
  editable,
}: {
  projectKey: string;
  pipelineId: number;
  editable: boolean;
}) {
  const t = useTranslations('pipelines.project.hook');
  const hook = usePipelineHook(projectKey, pipelineId);
  const control = usePipelineHookControl(projectKey, pipelineId);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'renew' | 'delete' | null>(null);
  if (hook.isPending) return null;
  const current = hook.data ?? null;
  const create = async () => setSecret((await control.create.mutateAsync()).secret);

  return (
    <div className="space-y-3 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Webhook className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t('title')}</span>
        {current?.lastUsedAt && (
          <span className="text-xs text-muted-foreground">
            {t('lastUsed', { time: formatDateTime(current.lastUsedAt) })}
          </span>
        )}
        {editable && current && (
          <span className="ms-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setConfirm('renew')}>
              <KeyRound /> {t('renew')}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              aria-label={t('delete')}
              title={t('delete')}
              onClick={() => setConfirm('delete')}
            >
              <Trash2 />
            </Button>
          </span>
        )}
      </div>
      {current ? (
        <CopyableValue title={t('url')} value={`${API_URL}${current.url}`} copyLabel={t('copy')} />
      ) : editable ? (
        <Button
          size="sm"
          variant="outline"
          disabled={control.create.isPending}
          onClick={() => void create()}
        >
          {t('create')}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">{t('none')}</p>
      )}
      {secret && (
        <CopyableValue
          title={t('secret')}
          value={secret}
          hint={t('secretOnce')}
          copyLabel={t('copy')}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm === 'renew' ? t('renew') : t('delete')}
          confirmLabel={confirm === 'renew' ? t('renew') : t('delete')}
          onConfirm={async () => {
            if (confirm === 'renew') await create();
            else {
              await control.remove.mutateAsync();
              setSecret(null);
            }
            setConfirm(null);
          }}
          onClose={() => setConfirm(null)}
        >
          <p className="text-sm text-muted-foreground">
            {confirm === 'renew' ? t('renewMessage') : t('deleteMessage')}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
