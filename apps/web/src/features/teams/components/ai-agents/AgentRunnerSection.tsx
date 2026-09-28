import { Terminal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { AgentRunnerStatus } from '@/components/common/agent-chat/AgentRunnerStatus';
import { AgentFormSection } from './AgentFormSection';
import { SettingsGroup, SettingsRow } from '@/design-system';
import { AgentRunnerCodeBlock } from './AgentRunnerCodeBlock';
import { AgentRunnerHelpSheet, RUN_COMMAND } from './AgentRunnerHelpSheet';

// The Runner section of an external agent: whether its runner is connected right
// now, and how to start one. Who may give the agent work is an access question and
// lives in the Access section, so nothing here is a setting.
export default function AgentRunnerSection({
  agent,
  ...section
}: {
  // The saved agent, for its presence. Null while creating: no key exists yet, so the
  // state reads as not connected.
  agent: AiAgent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('teams.agents');

  return (
    <AgentFormSection
      {...section}
      icon={Terminal}
      title={t('runner')}
      hint={t('runnerHint')}
      // Presence belongs in the header: it is the section's state at a glance, and it
      // stays visible while the section is collapsed.
      headerRight={<AgentRunnerStatus agent={agent} compact />}
    >
      <SettingsGroup>
        <SettingsRow label={t('runnerWayCli')} description={t('runnerWayCliHint')} stacked>
          <AgentRunnerCodeBlock code={RUN_COMMAND} />
          <AgentRunnerHelpSheet />
        </SettingsRow>
        <SettingsRow label={t('runnerWayApi')} description={t('runnerWayApiHint')} />
      </SettingsGroup>
    </AgentFormSection>
  );
}
