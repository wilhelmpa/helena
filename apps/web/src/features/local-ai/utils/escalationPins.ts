import type { EscalationPin } from '@/lib/api/endpoints/localAi';

// The pins with one agent's choice changed: `auto` drops its pin (the rules decide), the
// others set it. Pins of other agents, projects and tasks stay as they are.
export function pinsWithAgent(
  pins: EscalationPin[],
  agentId: number,
  mode: EscalationPin['mode'],
  model: string | null,
): EscalationPin[] {
  const others = pins.filter((pin) => !(pin.scope === 'agent' && pin.id === agentId));
  if (mode === 'auto') return others;
  return [...others, { scope: 'agent', id: agentId, mode, model: mode === 'strong' ? model : null }];
}
