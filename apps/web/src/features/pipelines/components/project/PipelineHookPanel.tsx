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
import { Inline, Stack, Text } from '@/design-system';

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
    <Stack gap={3} pad={3} className="rounded-md border bg-background">
      <Inline gap={2} wrap>
        <Webhook className="size-4 text-muted-foreground" />
        <Text as="span" size="sm" className="font-medium">
          {t('title')}
        </Text>
        {current?.lastUsedAt && (
          <Text as="span" size="xs" tone="muted">
            {t('lastUsed', { time: formatDateTime(current.lastUsedAt) })}
          </Text>
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
      </Inline>
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
        <Text as="p" size="xs" tone="muted">
          {t('none')}
        </Text>
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
          <Text as="p" size="sm" tone="muted">
            {confirm === 'renew' ? t('renewMessage') : t('deleteMessage')}
          </Text>
        </ConfirmDialog>
      )}
    </Stack>
  );
}
