import { Variable } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { EnvironmentVariableList } from '@/features/access/EnvironmentVariableList';
import { AgentFormSection } from './AgentFormSection';

// The environment variables the agent's runs receive from Zugänge, names only.
export default function AgentEnvironmentSection({
  agent,
  open,
  onOpenChange,
}: {
  agent: AiAgent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('credentials.environment');
  return (
    <AgentFormSection
      open={open}
      onOpenChange={onOpenChange}
      icon={Variable}
      title={t('title')}
      hint={t('agentHint')}
    >
      {open && <EnvironmentVariableList teamId={agent.teamId} target={{ agentId: agent.id }} />}
    </AgentFormSection>
  );
}
