'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { UpdateCenter, UpdateSettings } from '@/lib/api/endpoints/updateCenter';
import { RoutineCronInput } from '@/features/routines/components/RoutineCronInput';
import { RoutineTimezoneInput } from '@/features/routines/components/RoutineTimezoneInput';
import { parseScheduleInput } from '@/features/routines/utils/cronSchedule';
import { useSetUpdateSettings } from '../services/updateCenter.service';

const AUTO = 'auto';
const REASONING = ['none', 'minimal', 'low', 'medium', 'high'];

// Automatic summaries select a text-only capable agent and a model the account serves.
export default function UpdateSettingsSection({ center }: { center: UpdateCenter }) {
  const t = useTranslations('updates.settings');
  const save = useSetUpdateSettings();
  const settings = center.settings;
  const digest = center.digest;
  const [cron, setCron] = useState(settings.cron);
  const [timezone, setTimezone] = useState(settings.timezone);
  const cronId = useId();
  const zoneId = useId();
  const parsed = parseScheduleInput(cron);
  const scheduleChanged = cron !== settings.cron || timezone !== settings.timezone;

  function patch(value: Partial<UpdateSettings>) {
    save.mutate(value, { onSuccess: () => toast.success(t('saved')) });
  }

  const autoAgent = digest.agentName
    ? t('automaticAgent', { name: digest.agentName })
    : t('automatic');
  const autoModel =
    digest.model && settings.model === null
      ? t('automaticModel', { model: digest.model })
      : t('automatic');
  const levels =
    digest.models.find((model) => model.id === (settings.model ?? digest.model))?.thinkingLevels ??
    REASONING;

  return (
    <SettingsSection title={t('title')}>
      <SettingsCard className="divide-y">
        <SettingsRow
          title={t('schedule')}
          description={t('scheduleDescription')}
          control={
            <Switch
              checked={settings.enabled}
              disabled={save.isPending}
              onCheckedChange={(enabled) => patch({ enabled })}
            />
          }
        />
        {settings.enabled && (
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm" htmlFor={cronId}>
              <span className="text-xs text-muted-foreground">{t('cron')}</span>
              <RoutineCronInput id={cronId} value={cron} onChange={setCron} />
            </label>
            <label className="space-y-1 text-sm" htmlFor={zoneId}>
              <span className="text-xs text-muted-foreground">{t('timezone')}</span>
              <RoutineTimezoneInput id={zoneId} value={timezone} onChange={setTimezone} />
            </label>
            {scheduleChanged && (
              <div className="sm:col-span-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!parsed.ok || save.isPending}
                  onClick={() => parsed.ok && patch({ cron: parsed.cron, timezone })}
                >
                  {t('save')}
                </Button>
              </div>
            )}
          </div>
        )}
        <SettingsRow
          title={t('summarize')}
          description={t('summarizeDescription')}
          control={
            <Switch
              checked={settings.summarize}
              disabled={save.isPending}
              onCheckedChange={(summarize) => patch({ summarize })}
            />
          }
        />
        {settings.summarize && (
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
            <Field label={t('agent')}>
              <Select
                value={settings.agentId === null ? AUTO : String(settings.agentId)}
                onValueChange={(value) => patch({ agentId: value === AUTO ? null : Number(value) })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>
                    {digest.agents.length ? autoAgent : t('noAgent')}
                  </SelectItem>
                  {digest.agents.map((agent) => (
                    <SelectItem key={agent.id} value={String(agent.id)}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('model')}>
              <Select
                value={settings.model ?? AUTO}
                onValueChange={(value) => patch({ model: value === AUTO ? null : value })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>{autoModel}</SelectItem>
                  {settings.model &&
                    !digest.models.some((model) => model.id === settings.model) && (
                      <SelectItem value={settings.model}>{settings.model}</SelectItem>
                    )}
                  {digest.models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name || model.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('reasoning')}>
              <Select
                value={settings.reasoning}
                onValueChange={(reasoning) => patch({ reasoning })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([settings.reasoning, ...levels])].map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}
        <SettingsRow
          title={t('claudeChannel')}
          description="downloads.claude.ai"
          control={
            <Select
              value={settings.claudeChannel}
              onValueChange={(value) =>
                patch({ claudeChannel: value as UpdateSettings['claudeChannel'] })
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">{t('channels.latest')}</SelectItem>
                <SelectItem value="stable">{t('channels.stable')}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <div className="space-y-2 px-4 py-3">
          <p className="text-sm font-medium">{t('componentModes')}</p>
          <p className="text-xs text-muted-foreground">{t('componentModesDescription')}</p>
          {center.items
            .filter((item) => item.applicable)
            .map((item) => (
              <SettingsRow
                key={`${item.source}/${item.component}`}
                title={item.name}
                description={item.risk ? t(`risk.${item.risk}`) : t('risk.unknown')}
                control={
                  <Select
                    value={item.mode}
                    onValueChange={(mode) =>
                      patch({
                        modes: { [`${item.source}/${item.component}`]: mode as 'auto' | 'manual' },
                      })
                    }
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto" disabled={!item.autoAllowed}>
                        {t('mode.auto')}
                      </SelectItem>
                      <SelectItem value="manual">{t('mode.manual')}</SelectItem>
                    </SelectContent>
                  </Select>
                }
              />
            ))}
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
