'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { PipelineDraft } from '../../hooks/usePipelineDraft';

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
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t('readOnly')}</p>
        <p className="text-sm whitespace-pre-wrap text-muted-foreground" dir="auto">
          {draft.description || t('noDescription')}
        </p>
      </div>
    );

  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="space-y-1.5">
        <Label htmlFor="pipeline-name">{t('name')}</Label>
        <Input
          id="pipeline-name"
          value={draft.name}
          maxLength={120}
          dir="auto"
          aria-invalid={!draft.name.trim()}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
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
      </div>
    </div>
  );
}
