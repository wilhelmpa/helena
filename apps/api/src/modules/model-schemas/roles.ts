import { MODEL_ROLES } from './templates';

const ROLE_WORDS: [RegExp, string][] = [
  [/koordinat|coordinat|lead/i, 'coordinator'],
  [/\bqa\b|quality|code.?review/i, 'reviewer'],
  [/quant.?backtest|strategy.?develop/i, 'trading'],
  [/shopify.?dev|programm|cod(er|ing)|entwick|software|developer/i, 'coder'],
  [/review|prüf|qualit/i, 'reviewer'],
  [/plan|architekt/i, 'planning'],
  [/research|recherche|suche|analyst|analyse/i, 'research'],
  [/content|seo|text|redak/i, 'content'],
  [/assistenz|assistant/i, 'assistant'],
  [/finanz|financ|beleg|buchhalt|rechnung/i, 'finance'],
  [/trad|signal|markt/i, 'trading'],
  [/browser|operator/i, 'browser'],
  [/support|hilfe/i, 'support'],
  [/devops|betrieb|infra/i, 'devops'],
];
export function inferModelRole(
  agent: { agentRole: string; username: string },
  assignment?: {
    role: string | null;
    roleTitle: string;
    capabilities: string[];
  } | null,
): string {
  if (agent.agentRole === 'home') return 'home';
  if (assignment?.role === 'coordinator' || assignment?.role === 'reviewer') return assignment.role;
  for (const words of [
    assignment?.roleTitle,
    (assignment?.capabilities ?? []).join(' '),
    agent.username,
  ]) {
    for (const [pattern, role] of ROLE_WORDS) if (pattern.test(words ?? '')) return role;
  }
  if (assignment?.role && MODEL_ROLES.includes(assignment.role as never)) return assignment.role;
  return 'general';
}
