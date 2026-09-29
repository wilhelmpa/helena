'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { PipelineDraft } from '../../hooks/usePipelineDraft';
import { Stack, Text } from '@/design-system';

export default function PipelineMetaFields({
  draft,
  editable,
  onChange,
}: {
  draft: PipelineDraft;
  editable: boolean;
  onChange: (patch: Partial<PipelineDraft>) => void;
}) {
  const t = useTranslations('pipelines.editor');

  if (!editable)
    return (
      <Stack gap={1}>
        <Text as="p" size="xs" tone="muted">
          {t('readOnly')}
        </Text>
        <Text as="p" size="sm" tone="muted" className="whitespace-pre-wrap" dir="auto">
          {draft.description || t('noDescription')}
        </Text>
      </Stack>
    );

  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Stack gap={2}>
        <Label htmlFor="pipeline-name">{t('name')}</Label>
        <Input
          id="pipeline-name"
          value={draft.name}
          maxLength={120}
          dir="auto"
          aria-invalid={!draft.name.trim()}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </Stack>
      <Stack gap={2}>
        <Label htmlFor="pipeline-description">{t('description')}</Label>
        <Textarea
          id="pipeline-description"
          value={draft.description}
          maxLength={2000}
          rows={1}
          dir="auto"
          placeholder={t('descriptionPlaceholder')}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </Stack>
    </div>
  );
}
