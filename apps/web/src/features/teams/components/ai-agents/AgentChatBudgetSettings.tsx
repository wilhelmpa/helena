'use client';

import { useTranslations } from 'next-intl';
import { SettingsGroup, SettingsRow, TextField, Switch } from '@/design-system';
import type { HelenaRuntimeSettings } from '@/lib/api/endpoints/agents';

// Minimal data binding; the final arrangement belongs to Claude's design-system work.
export default function AgentChatBudgetSettings({
  value,
  onChange,
  disabled,
}: {
  value: HelenaRuntimeSettings;
  onChange: (value: HelenaRuntimeSettings) => void;
  disabled: boolean;
}) {
  const t = useTranslations('teams.agents.runtimePolicy.chatBudget');
  return (
    <SettingsGroup title={t('title')}>
      <SettingsRow label={t('seconds')} htmlFor="agent-chat-budget">
        <TextField
          id="agent-chat-budget"
          type="number"
          min={60}
          max={7200}
          disabled={disabled}
          value={value.chatBudgetSeconds ?? 900}
          onChange={(event) =>
            onChange({
              ...value,
              chatBudgetSeconds: event.target.value === '' ? undefined : Number(event.target.value),
            })
          }
        />
      </SettingsRow>
      <SettingsRow label={t('summarize')} htmlFor="agent-chat-budget-summary">
        <Switch
          id="agent-chat-budget-summary"
          disabled={disabled}
          checked={value.chatBudgetBehavior !== 'fail'}
          onCheckedChange={(checked) =>
            onChange({ ...value, chatBudgetBehavior: checked ? 'summarize' : 'fail' })
          }
        />
      </SettingsRow>
      <SettingsRow label={t('summarySeconds')} htmlFor="agent-chat-summary-seconds">
        <TextField
          id="agent-chat-summary-seconds"
          type="number"
          min={5}
          max={180}
          disabled={disabled}
          value={value.chatSummarySeconds ?? 60}
          onChange={(event) =>
            onChange({
              ...value,
              chatSummarySeconds:
                event.target.value === '' ? undefined : Number(event.target.value),
            })
          }
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
