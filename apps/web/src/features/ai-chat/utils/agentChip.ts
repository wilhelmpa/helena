import type { AiAgent } from '@/lib/api/endpoints/agents';
import { friendlyModel } from '@/utils/modelNames';

// The Home agent is Helena, whatever its account is called (owner, 28.09.).
export function agentDisplayName(agent: Pick<AiAgent, 'name' | 'agentRole'>): string {
  return agent.agentRole === 'home' ? 'Helena' : agent.name;
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
): { name: string; model: string; label: string } {
  const name = agentDisplayName(agent);
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
