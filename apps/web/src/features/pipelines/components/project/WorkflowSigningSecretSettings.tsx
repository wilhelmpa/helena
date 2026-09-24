'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import CopyableValue from '@/components/common/page/CopyableValue';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useRotateSigningSecret, useSigningSecret } from '@/services/engine.service';

// The key the webhook steps of the project's workflows sign their requests with (Standard
// Webhooks), for the receiver to check that a request comes from Helena. Read only when a
// person asks to see it; renewing it makes every receiver need the new one.
export default function WorkflowSigningSecretSettings({
  projectKey,
  editable,
}: {
  projectKey: string;
  editable: boolean;
}) {
  const t = useTranslations('pipelines.project.signing');
  const [shown, setShown] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const secret = useSigningSecret(projectKey, shown);
  const rotate = useRotateSigningSecret(projectKey);
  if (!editable) return null;

  return (
    <div className="space-y-3 border-b pb-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{t('title')}</h3>
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => setShown(!shown)}>
            {shown ? t('hide') : t('show')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRenewing(true)}>
            {t('renew')}
          </Button>
        </div>
      </div>
      {shown && secret.data && (
        <CopyableValue title={t('secret')} value={secret.data.secret} copyLabel={t('copy')} />
      )}
      {renewing && (
        <ConfirmDialog
          title={t('renew')}
          confirmLabel={t('renew')}
          onConfirm={async () => {
            await rotate.mutateAsync();
            setShown(true);
            setRenewing(false);
          }}
          onClose={() => setRenewing(false)}
        >
          <p className="text-sm text-muted-foreground">{t('renewMessage')}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
