'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { EscalationPin } from '@/lib/api/endpoints/localAi';
import { Segmented, SettingsGroup, SettingsRow, TextField } from '@/design-system';
import { useEscalation, useUpdateEscalation } from '../services/localAi.service';
import { pinsWithAgent } from '../utils/escalationPins';

type Mode = EscalationPin['mode'];

// "Festlegung für diesen Agenten" (owner 28.09.): an agent's own escalation choice — the
// rules (auto), always the local model, or always a strong one — in its dialog; the rules
// themselves are central in Administrator › Agenten und Modelle. For the Administrator.
export default function AgentEscalationPin({ agentId }: { agentId: number }) {
  const t = useTranslations('localAi.escalation');
  const settings = useEscalation();
  const update = useUpdateEscalation();
  const pin = settings.data?.pins.find((item) => item.scope === 'agent' && item.id === agentId);
  const [model, setModel] = useState<string | null>(null);
  if (!settings.data) return null;
  const mode: Mode = pin?.mode ?? 'auto';
  const save = (next: Mode, nextModel: string | null) =>
    update.mutate(
      { pins: pinsWithAgent(settings.data!.pins, agentId, next, nextModel) },
      {
        onSuccess: () => toast.success(t('pinSaved')),
        onError: (error: Error) => toast.error(error.message),
      },
    );
  const modelText = model ?? pin?.model ?? '';
  return (
    <SettingsGroup title={t('title')} description={t('agentHint')}>
      <SettingsRow label={t('pinLabel')} description={t(`pinModes.${mode}Hint`)}>
        <Segmented<Mode>
          label={t('pinLabel')}
          value={mode}
          onChange={(next) => save(next, next === 'strong' ? (pin?.model ?? null) : null)}
          options={[
            { value: 'auto', label: t('pinModes.auto') },
            { value: 'local', label: t('pinModes.local') },
            { value: 'strong', label: t('pinModes.strong') },
          ]}
        />
      </SettingsRow>
      {mode === 'strong' && (
        <SettingsRow label={t('model')} description={t('pinModelHint')} nested>
          <TextField
            dir="ltr"
            aria-label={t('model')}
            value={modelText}
            placeholder={settings.data.defaultModel}
            onChange={(event) => setModel(event.target.value)}
            onBlur={() => {
              const next = modelText.trim() || null;
              if (next !== (pin?.model ?? null)) save('strong', next);
            }}
          />
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}
