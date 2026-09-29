import { useTranslations } from 'next-intl';
import { AGENT_NETWORK_MODES, type AgentNetworkMode } from '@/lib/api/endpoints/agentNetwork';
import { byKey } from '@/utils/messageKey';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AgentNetworkForm as Form } from '../../hooks/useAgentNetworkForm';

import { Text } from '@/design-system';

// Set on the Select to mean "no override": the agent follows the project's mode.
// Radix Select needs a non-empty string value, so null is not usable directly.
const FOLLOW_PROJECT = 'project';

// One row per agent of the project, each free to override the project's mode. The
// allow/deny lists stay the project's regardless of which mode an agent is on.
export default function SettingsNetworkAgentOverrides({ form }: { form: Form }) {
  const t = useTranslations('settings.network');
  const modeLabel = (mode: AgentNetworkMode) => byKey(t)(`mode.${mode}.label`);
  const disabled = !form.editable || form.saving;

  return (
    <SettingsSection title={t('perAgentTitle')} description={t('perAgentHint')}>
      {form.agents.length === 0 ? (
        <Text as="p" size="xs" tone="muted">
          {t('noAgents')}
        </Text>
      ) : (
        <SettingsCard className="divide-y divide-border/60">
          {form.agents.map((agent) => {
            const value = form.agentModes[String(agent.id)] ?? FOLLOW_PROJECT;
            return (
              <SettingsRow
                key={agent.id}
                title={agent.name}
                description={`@${agent.username}`}
                control={
                  <Select
                    value={value}
                    disabled={disabled}
                    onValueChange={(next) =>
                      form.setAgentMode(
                        agent.id,
                        next === FOLLOW_PROJECT ? null : (next as AgentNetworkMode),
                      )
                    }
                  >
                    <SelectTrigger size="sm" className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={FOLLOW_PROJECT}>
                        {t('followProject', { mode: modeLabel(form.mode) })}
                      </SelectItem>
                      {AGENT_NETWORK_MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {modeLabel(mode)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            );
          })}
        </SettingsCard>
      )}
    </SettingsSection>
  );
}
