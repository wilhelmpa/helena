'use client';

import { useTranslations } from 'next-intl';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';

import { Stack, Text, Inline } from '@/design-system';

// Asks, before copying, whether to include the type-scoped fields or copy only the
// global ones. Shown only when the project has type-scoped fields.
export default function CustomFieldsCopyDialog({
  globalCount,
  scopedCount,
  onChoose,
  onClose,
}: {
  globalCount: number;
  scopedCount: number;
  onChoose: (includeTypeScoped: boolean) => void;
  onClose: () => void;
}) {
  const t = useTranslations('settings.customFields');

  return (
    <Modal title={t('copyTitle')} onClose={onClose}>
      <Stack gap={4}>
        <Text as="p" size="sm" tone="muted">
          {t('copyQuestion', { scoped: scopedCount, global: globalCount })}
        </Text>
        <Inline gap={2} align="stretch" justify="end" className="flex justify-end">
          <Button variant="outline" onClick={() => onChoose(false)} disabled={globalCount === 0}>
            {t('copyGlobalOnly')}
          </Button>
          <Button onClick={() => onChoose(true)}>{t('copyIncludeScoped')}</Button>
        </Inline>
      </Stack>
    </Modal>
  );
}
