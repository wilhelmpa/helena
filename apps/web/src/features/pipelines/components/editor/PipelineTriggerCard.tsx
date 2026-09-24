'use client';

import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TRIGGER_TYPES, type TriggerType } from '@/lib/api/endpoints/pipelines';
import { useEngineSettings } from '@/services/engine.service';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { usePipelineLabels } from '../../hooks/usePipelineLabels';
import { triggerOf } from '../../utils/editorState';
import { triggerIssues } from '../../utils/issueDisplay';
import PipelineCard from './PipelineCard';
import PipelineField from './PipelineField';
import PipelineTriggerFields from './PipelineTriggerFields';

export default function PipelineTriggerCard() {
  const t = useTranslations('pipelines');
  const { definition, editable, issues, change } = usePipelineEditor();
  const labels = usePipelineLabels();
  const timezone = useEngineSettings().data?.defaultTimezone;
  const { trigger } = definition;

  return (
    <PipelineCard title={t('trigger.title')} issues={triggerIssues(issues)}>
      {editable ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <PipelineField label={t('trigger.type')} htmlFor="pipeline-trigger">
            <Select
              value={trigger.type}
              onValueChange={(type) =>
                change((current) => ({
                  ...current,
                  trigger: triggerOf(type as TriggerType, timezone),
                }))
              }
            >
              <SelectTrigger id="pipeline-trigger" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIGGER_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`triggers.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PipelineField>
          <PipelineTriggerFields
            trigger={trigger}
            onChange={(next) => change((current) => ({ ...current, trigger: next }))}
          />
        </div>
      ) : (
        <p className="text-sm">{labels.trigger(trigger)}</p>
      )}
    </PipelineCard>
  );
}
