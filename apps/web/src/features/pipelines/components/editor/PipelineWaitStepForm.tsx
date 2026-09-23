'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { WaitStep } from '@/lib/api/endpoints/pipelines';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { fieldIssues } from '../../utils/issueDisplay';
import PipelineField from './PipelineField';
import PipelineNumberInput from './PipelineNumberInput';

const UNITS = { minutes: 1, hours: 60, days: 1440 } as const;
type Unit = keyof typeof UNITS;

const unitOf = (minutes: number): Unit =>
  minutes % 1440 === 0 ? 'days' : minutes % 60 === 0 ? 'hours' : 'minutes';

// A pause: for a while, or until a date of the task at a time of day. The delay is
// stored in minutes and edited in the unit it reads best in.
export default function PipelineWaitStepForm({
  step,
  onChange,
}: {
  step: WaitStep;
  onChange: (step: WaitStep) => void;
}) {
  const t = useTranslations('pipelines.inspector.wait');
  const { issues } = usePipelineEditor();
  const issuesOf = (field: string) => fieldIssues(issues, step.id, field);
  const wait = step.wait;
  const [unit, setUnit] = useState<Unit>(wait.kind === 'delay' ? unitOf(wait.minutes) : 'hours');

  return (
    <>
      <PipelineField label={t('kind')} htmlFor="step-wait" issues={issuesOf('wait.kind')}>
        <Select
          value={wait.kind}
          onValueChange={(kind) =>
            onChange({
              ...step,
              wait:
                kind === 'delay'
                  ? { kind, minutes: 60 }
                  : { kind: 'until', field: 'dueDate', time: '09:00' },
            })
          }
        >
          <SelectTrigger id="step-wait" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="delay">{t('kinds.delay')}</SelectItem>
            <SelectItem value="until">{t('kinds.until')}</SelectItem>
          </SelectContent>
        </Select>
      </PipelineField>
      {wait.kind === 'delay' ? (
        <div className="grid grid-cols-2 gap-3">
          <PipelineField
            label={t('amount')}
            htmlFor="step-amount"
            issues={issuesOf('wait.minutes')}
          >
            <PipelineNumberInput
              id="step-amount"
              value={Number.isNaN(wait.minutes) ? null : wait.minutes / UNITS[unit]}
              min={1}
              max={43200 / UNITS[unit]}
              onChange={(amount) =>
                onChange({
                  ...step,
                  wait: {
                    kind: 'delay',
                    minutes: amount === null ? Number.NaN : amount * UNITS[unit],
                  },
                })
              }
            />
          </PipelineField>
          <PipelineField label={t('unit')}>
            <Select
              value={unit}
              onValueChange={(next) => {
                const amount = wait.minutes / UNITS[unit];
                setUnit(next as Unit);
                onChange({
                  ...step,
                  wait: { kind: 'delay', minutes: amount * UNITS[next as Unit] },
                });
              }}
            >
              <SelectTrigger className="w-full" aria-label={t('unit')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(UNITS) as Unit[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`units.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PipelineField>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <PipelineField label={t('field')} issues={issuesOf('wait.field')}>
            <Select
              value={wait.field}
              onValueChange={(field) =>
                onChange({ ...step, wait: { ...wait, field: field as 'dueDate' | 'startDate' } })
              }
            >
              <SelectTrigger className="w-full" aria-label={t('field')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dueDate">{t('fields.dueDate')}</SelectItem>
                <SelectItem value="startDate">{t('fields.startDate')}</SelectItem>
              </SelectContent>
            </Select>
          </PipelineField>
          <PipelineField
            label={t('time')}
            htmlFor="step-time"
            hint={t('timeHint')}
            issues={issuesOf('wait.time')}
          >
            <Input
              id="step-time"
              type="time"
              dir="ltr"
              value={wait.time}
              onChange={(event) =>
                onChange({ ...step, wait: { ...wait, time: event.target.value } })
              }
            />
          </PipelineField>
        </div>
      )}
    </>
  );
}
