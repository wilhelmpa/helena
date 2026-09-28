'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type {
  EscalationFailure,
  EscalationPatch,
  EscalationSettings,
} from '@/lib/api/endpoints/localAi';
import { useEscalation, useUpdateEscalation } from '../services/localAi.service';

const FAILURES: EscalationFailure[] = ['tests-failed', 'loop', 'timeout', 'error'];

// The escalation rules (Phase 2 draft): when a strong subscription model takes over from the
// local one. Stored and shown; nothing acts on them yet, the badge says so.
export default function LocalAiEscalationSection() {
  const t = useTranslations('localAi.escalation');
  const settings = useEscalation();
  if (!settings.data) return null;
  return (
    <SettingsSection
      title={t('title')}
      description={t('description')}
      action={
        <Badge variant="outline" className="text-xs">
          {t('draft')}
        </Badge>
      }
    >
      <EscalationForm settings={settings.data} />
    </SettingsSection>
  );
}

// A model id field that saves when it loses focus.
function ModelField({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
  onSave: (value: string | null) => void;
}) {
  const [text, setText] = useState(value ?? '');
  return (
    <Input
      dir="ltr"
      aria-label={label}
      className="h-8 w-44"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== (value ?? '') && onSave(text.trim() || null)}
    />
  );
}

function EscalationForm({ settings }: { settings: EscalationSettings }) {
  const t = useTranslations('localAi.escalation');
  const update = useUpdateEscalation();
  const save = (patch: EscalationPatch) =>
    update.mutate(patch, { onError: (error: Error) => toast.error(error.message) });
  const [threshold, setThreshold] = useState(
    String(Math.round(settings.uncertainty.threshold * 100)),
  );
  return (
    <SettingsCard className="divide-y text-sm">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1 font-medium">{t('enabled')}</span>
        <ModelField
          label={t('defaultModel')}
          value={settings.defaultModel}
          onSave={(defaultModel) => defaultModel && save({ defaultModel })}
        />
        <Switch
          aria-label={t('enabled')}
          checked={settings.enabled}
          onCheckedChange={(enabled) => save({ enabled })}
        />
      </div>
      {settings.kinds.map((entry) => (
        <div key={entry.kind} className="flex flex-wrap items-center gap-3 px-4 py-2">
          <span className="min-w-0 flex-1">{t(`kinds.${entry.kind}`)}</span>
          <ModelField
            label={t('model')}
            value={entry.model}
            placeholder={settings.defaultModel}
            onSave={(model) => save({ kinds: [{ ...entry, model }] })}
          />
          <Switch
            aria-label={t(`kinds.${entry.kind}`)}
            checked={entry.enabled}
            onCheckedChange={(enabled) => save({ kinds: [{ ...entry, enabled }] })}
          />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2">
        <span className="min-w-0 flex-1">{t('uncertainty')}</span>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {t('threshold')}
          <Input
            inputMode="numeric"
            className="h-8 w-16"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => {
              const value = Number(threshold) / 100;
              if (value > 0 && value < 1 && value !== settings.uncertainty.threshold)
                save({ uncertainty: { threshold: value } });
            }}
          />
          %
        </label>
        <Switch
          aria-label={t('uncertainty')}
          checked={settings.uncertainty.enabled}
          onCheckedChange={(enabled) => save({ uncertainty: { enabled } })}
        />
      </div>
      <div className="flex flex-col gap-2 px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="min-w-0 flex-1">{t('failure')}</span>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {t('localAttempts')}
            <Input
              inputMode="numeric"
              className="h-8 w-12"
              defaultValue={String(settings.failure.localAttempts)}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (Number.isInteger(value) && value >= 0 && value <= 5)
                  save({ failure: { localAttempts: value } });
              }}
            />
          </label>
          <Switch
            aria-label={t('failure')}
            checked={settings.failure.enabled}
            onCheckedChange={(enabled) => save({ failure: { enabled } })}
          />
        </div>
        <div className="flex flex-wrap gap-4 text-xs">
          {FAILURES.map((failure) => (
            <label key={failure} className="flex items-center gap-2">
              <Checkbox
                checked={settings.failure.on.includes(failure)}
                onCheckedChange={(checked) =>
                  save({
                    failure: {
                      on:
                        checked === true
                          ? FAILURES.filter(
                              (item) => item === failure || settings.failure.on.includes(item),
                            )
                          : settings.failure.on.filter((item) => item !== failure),
                    },
                  })
                }
              />
              {t(`failures.${failure}`)}
            </label>
          ))}
        </div>
      </div>
      <p className="px-4 py-2 text-xs text-muted-foreground">
        {settings.pins.length === 0 ? t('pinsNone') : t('pins', { count: settings.pins.length })}
      </p>
    </SettingsCard>
  );
}
