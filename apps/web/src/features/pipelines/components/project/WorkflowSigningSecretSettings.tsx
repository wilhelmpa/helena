'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import CopyableValue from '@/components/common/page/CopyableValue';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useRotateSigningSecret, useSigningSecret } from '@/services/engine.service';
import { Inline, SettingsRow, Text } from '@/design-system';

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
    <>
      <SettingsRow label={t('title')} description={t('hint')}>
        <Inline gap={2} align="stretch">
          <Button size="sm" variant="outline" onClick={() => setShown(!shown)}>
            {shown ? t('hide') : t('show')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRenewing(true)}>
            {t('renew')}
          </Button>
        </Inline>
      </SettingsRow>
      {shown && secret.data && (
        <SettingsRow label={t('secret')} stacked nested>
          <CopyableValue title={t('secret')} value={secret.data.secret} copyLabel={t('copy')} />
        </SettingsRow>
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
          <Text as="p" size="sm" tone="muted">
            {t('renewMessage')}
          </Text>
        </ConfirmDialog>
      )}
    </>
  );
}
