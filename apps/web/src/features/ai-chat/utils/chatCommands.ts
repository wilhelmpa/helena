import type { ChatPrompt } from '@/lib/api/endpoints/chatPrompts';

// The slash commands of the chat composer. Hermes answers a chat as a one-shot query
// (`hermes chat --query-file -`), and that path does not run its own slash commands:
// the text reaches the model as it is. So the commands Hermes knows from its CLI are
// carried out by Plan where Plan holds what they change, and the ones that would change
// what Plan controls are refused with a note. docs/volition/chat.md lists the mapping.

// What Plan does for a command.
export type ChatCommandAction =
  | 'new'
  | 'retry'
  | 'undo'
  | 'title'
  | 'model'
  | 'reasoning'
  | 'skills'
  | 'memory'
  | 'usage'
  | 'stop';

// Why a command is not carried out in Plan.
export type ChatCommandRefusal = 'schedules' | 'approvals' | 'config' | 'outside';

export interface ChatCommand {
  name: string;
  aliases: string[];
  // The argument placeholder Hermes documents, as the menu shows it.
  args?: string;
  action?: ChatCommandAction;
  refusal?: ChatCommandRefusal;
}

const command = (name: string, rest: Partial<Omit<ChatCommand, 'name'>> = {}): ChatCommand => ({
  name,
  aliases: [],
  ...rest,
});

export const CHAT_COMMANDS: ChatCommand[] = [
  command('new', { aliases: ['reset', 'clear'], action: 'new' }),
  command('retry', { action: 'retry' }),
  command('undo', { action: 'undo' }),
  command('title', { args: '[name]', action: 'title' }),
  command('model', { args: '[model]', action: 'model' }),
  command('reasoning', { args: '[level]', action: 'reasoning' }),
  command('skills', { args: '[search]', action: 'skills' }),
  command('memory', { action: 'memory' }),
  command('usage', { aliases: ['status', 'context'], action: 'usage' }),
  command('stop', { action: 'stop' }),
  command('cron', { refusal: 'schedules' }),
  command('loop', { refusal: 'schedules' }),
  command('heartbeat', { refusal: 'schedules' }),
  command('goal', { refusal: 'outside' }),
  command('yolo', { refusal: 'approvals' }),
  command('approvals', { refusal: 'approvals' }),
  command('approve', { refusal: 'approvals' }),
  command('deny', { refusal: 'approvals' }),
  command('config', { refusal: 'config' }),
  command('personality', { refusal: 'config' }),
  command('skin', { refusal: 'config' }),
  command('tools', { refusal: 'config' }),
  command('reload', { aliases: ['reload-mcp', 'reload-skills'], refusal: 'config' }),
  command('update', { refusal: 'config' }),
  command('export', { refusal: 'config' }),
  command('import', { refusal: 'config' }),
  command('snapshot', { refusal: 'config' }),
  command('rollback', { refusal: 'config' }),
  command('pause', { refusal: 'config' }),
  command('restart', { refusal: 'outside' }),
  command('platforms', { aliases: ['gateway'], refusal: 'outside' }),
  command('sethome', { refusal: 'outside' }),
  command('handoff', { refusal: 'outside' }),
  command('bg', { aliases: ['background'], refusal: 'outside' }),
  command('kanban', { refusal: 'outside' }),
  command('curator', { refusal: 'outside' }),
];

// The command a text starts with: `/model gpt` is one, `/Users/x/file.md` is a path —
// a command's first word holds no further slash, the rule Hermes applies too.
export function parseSlashCommand(text: string): { name: string; args: string } | null {
  if (!text.startsWith('/')) return null;
  const [word, ...rest] = text.slice(1).split(/\s+/);
  if (!word || word.includes('/')) return null;
  return { name: word.toLowerCase(), args: rest.join(' ').trim() };
}

export function findCommand(name: string): ChatCommand | undefined {
  const key = name.toLowerCase();
  return CHAT_COMMANDS.find((entry) => entry.name === key || entry.aliases.includes(key));
}

// How well a query matches a name: its start, anywhere in it, or its letters in order.
// Negative for no match.
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 3;
  if (t.includes(q)) return 2;
  let at = 0;
  for (const char of t) if (char === q[at]) at += 1;
  return at === q.length ? 1 : -1;
}

export type SlashItem =
  | { kind: 'prompt'; prompt: ChatPrompt; score: number }
  | { kind: 'command'; command: ChatCommand; score: number };

// What the / menu offers for a query: the member's prompts and the commands, best match
// first. A refused command is listed only once the query names it, so the menu does not
// fill up with what cannot be run, and a member who types one learns why.
export function slashItems(query: string, prompts: ChatPrompt[]): SlashItem[] {
  const items: SlashItem[] = [];
  for (const prompt of prompts) {
    const score = Math.max(fuzzyScore(query, prompt.command), fuzzyScore(query, prompt.title) - 1);
    if (score >= 0) items.push({ kind: 'prompt', prompt, score: score + 0.5 });
  }
  for (const entry of CHAT_COMMANDS) {
    const score = Math.max(
      ...[entry.name, ...entry.aliases].map((name) => fuzzyScore(query, name)),
    );
    if (score < 0) continue;
    if (entry.refusal && !(query.length >= 2 && score >= 3)) continue;
    items.push({ kind: 'command', command: entry, score });
  }
  return items.sort((a, b) => b.score - a.score);
}
