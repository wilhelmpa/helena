import type { AiAgent } from '@/lib/api/endpoints/agents';
import { friendlyModel } from '@/utils/modelNames';
import { APP_NAME } from '@/utils/app';

// The Home agent is Helena, whatever its account is called (owner, 28.09.).
export function agentDisplayName(
  agent: Pick<AiAgent, 'name' | 'agentRole'>,
  appName = APP_NAME,
): string {
  return agent.agentRole === 'home' ? appName : agent.name;
}

export interface AgentChipWords {
  // "{name} (lokal)"
  local: (name: string) => string;
  // "Rückfall: {name}"
  fallback: (name: string) => string;
  // The agent's own default, when no model is set at all.
  standard: string;
}

// The composer's agent chip: "Helena · Flash (lokal)", and the model that really answered
// when the last answer came from the fallback — "Helena · Flash (lokal) · Rückfall: GPT-6
// Luna".
export function agentChipLabel(
  agent: Pick<AiAgent, 'name' | 'agentRole'>,
  modelId: string | null | undefined,
  answeredBy: string | null | undefined,
  words: AgentChipWords,
  appName = APP_NAME,
): { name: string; model: string; label: string } {
  const name = agentDisplayName(agent, appName);
  const shown = (id: string | null | undefined) => {
    const friendly = friendlyModel(id);
    if (!friendly) return null;
    return friendly.local ? words.local(friendly.name) : friendly.name;
  };
  const model = shown(modelId) ?? words.standard;
  const fallback = answeredBy && answeredBy !== modelId ? shown(answeredBy) : null;
  const label = [name, model, ...(fallback ? [words.fallback(fallback)] : [])].join(' · ');
  return { name, model, label };
}
