'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type {
  EscalationFailure,
  EscalationPatch,
  EscalationSettings,
} from '@/lib/api/endpoints/localAi';
import {
  Inline,
  Pill,
  PillButton,
  SettingsGroup,
  SettingsRow,
  Switch,
  TextField,
} from '@/design-system';
import { useEscalation, useUpdateEscalation } from '../services/localAi.service';

const FAILURES: EscalationFailure[] = ['tests-failed', 'loop', 'timeout', 'error'];

// The escalation rules (docs/plan-lokal-halogen.md, Phase 2): when a strong subscription
// model takes over from the local one — work of a hard kind, an unsure answer, a failed
// local attempt. Central in Administrator › Agenten und Modelle (owner 28.09.); an agent's
// own choice is in its dialog (AgentEscalationPin). Stored now; the central runtime follows
// them once it is in use, the badge says so.
export default function LocalAiEscalationSection() {
  const settings = useEscalation();
  if (!settings.data) return null;
  return <EscalationForm settings={settings.data} />;
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
    <TextField
      dir="ltr"
      aria-label={label}
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
    update.mutate(patch, {
      onSuccess: () => toast.success(t('saved')),
      onError: (error: Error) => toast.error(error.message),
    });
  const [threshold, setThreshold] = useState(
    String(Math.round(settings.uncertainty.threshold * 100)),
  );
  const [attempts, setAttempts] = useState(String(settings.failure.localAttempts));
  return (
    <SettingsGroup title={t('title')} description={t('description')}>
      <SettingsRow label={t('enabled')} description={t('draft')}>
        <Inline gap={2}>
          <Pill tone="warning">{t('draftBadge')}</Pill>
          <Switch
            aria-label={t('enabled')}
            checked={settings.enabled}
            onCheckedChange={(enabled) => save({ enabled })}
          />
        </Inline>
      </SettingsRow>
      <SettingsRow label={t('defaultModel')} description={t('defaultModelHint')}>
        <ModelField
          label={t('defaultModel')}
          value={settings.defaultModel}
          onSave={(defaultModel) => defaultModel && save({ defaultModel })}
        />
      </SettingsRow>
      {settings.kinds.map((entry) => (
        <SettingsRow key={entry.kind} label={t(`kinds.${entry.kind}`)} nested>
          <Inline gap={2}>
            <ModelField
              label={`${t(`kinds.${entry.kind}`)} · ${t('model')}`}
              value={entry.model}
              placeholder={settings.defaultModel}
              onSave={(model) => save({ kinds: [{ ...entry, model }] })}
            />
            <Switch
              aria-label={t(`kinds.${entry.kind}`)}
              checked={entry.enabled}
              onCheckedChange={(enabled) => save({ kinds: [{ ...entry, enabled }] })}
            />
          </Inline>
        </SettingsRow>
      ))}
      <SettingsRow label={t('uncertainty')} description={t('uncertaintyHint')}>
        <Inline gap={2}>
          <TextField
            inputMode="numeric"
            aria-label={t('threshold')}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => {
              const value = Number(threshold) / 100;
              if (value > 0 && value < 1 && value !== settings.uncertainty.threshold)
                save({ uncertainty: { threshold: value } });
            }}
          />
          <Switch
            aria-label={t('uncertainty')}
            checked={settings.uncertainty.enabled}
            onCheckedChange={(enabled) => save({ uncertainty: { enabled } })}
          />
        </Inline>
      </SettingsRow>
      <SettingsRow label={t('failure')} description={t('failureHint')}>
        <Inline gap={2}>
          <TextField
            inputMode="numeric"
            aria-label={t('localAttempts')}
            value={attempts}
            onChange={(e) => setAttempts(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => {
              const value = Number(attempts);
              if (Number.isInteger(value) && value >= 0 && value <= 5)
                save({ failure: { localAttempts: value } });
            }}
          />
          <Switch
            aria-label={t('failure')}
            checked={settings.failure.enabled}
            onCheckedChange={(enabled) => save({ failure: { enabled } })}
          />
        </Inline>
      </SettingsRow>
      <SettingsRow label={t('failureOn')} nested>
        <Inline gap={1} wrap>
          {FAILURES.map((failure) => {
            const on = settings.failure.on.includes(failure);
            return (
              <PillButton
                key={failure}
                tone={on ? 'active' : 'neutral'}
                aria-pressed={on}
                onClick={() =>
                  save({
                    failure: {
                      on: on
                        ? settings.failure.on.filter((item) => item !== failure)
                        : FAILURES.filter(
                            (item) => item === failure || settings.failure.on.includes(item),
                          ),
                    },
                  })
                }
              >
                {t(`failures.${failure}`)}
              </PillButton>
            );
          })}
        </Inline>
      </SettingsRow>
      <SettingsRow
        label={t('pinsLabel')}
        description={
          settings.pins.length === 0 ? t('pinsNone') : t('pins', { count: settings.pins.length })
        }
      />
    </SettingsGroup>
  );
}
