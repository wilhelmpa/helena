import type { ChatStatus, DynamicToolUIPart } from 'ai';
import type { PlanUIMessage } from './chatMessages';

// What the composer says about the answer, beside its own buttons — the one place the
// state of the conversation is shown and steered (owner, 2026-09-24: "the controls
// belong down at the input field"). The transcript itself shows only messages.
// - thinking: the answer was asked for and nothing of it has arrived yet
// - writing: it is arriving
// - queued: nothing yet, and the agent's runner is not there to pick it up
// - lost: the browser lost the answer's stream; it may still be running
// - stopped / failed: the answer ended early (stopped by the member, or the runner
//   gave up) — continue it or answer again
// - sendFailed: the question never reached the server
// - answered: an answer ended normally — it can be answered again
// - idle: nothing to say (an empty chat, or a question still being typed)
export type ComposerActivity =
  | 'thinking'
  | 'writing'
  | 'queued'
  | 'lost'
  | 'stopped'
  | 'failed'
  | 'sendFailed'
  | 'answered'
  | 'idle';

const hasContent = (message: PlanUIMessage) =>
  message.parts.some(
    (part) =>
      (part.type === 'text' && part.text.trim() !== '') ||
      (part.type === 'reasoning' && part.text.trim() !== '') ||
      part.type === 'dynamic-tool',
  );

export function composerActivity(
  messages: PlanUIMessage[],
  status: ChatStatus,
  agentOnline: boolean,
): ComposerActivity {
  const last = messages.at(-1);
  if (status === 'submitted' || status === 'streaming') {
    const arriving = last?.role === 'assistant' && hasContent(last);
    if (arriving) return 'writing';
    return agentOnline ? 'thinking' : 'queued';
  }
  if (!last) return 'idle';
  if (last.role === 'user') return status === 'error' ? 'sendFailed' : 'idle';
  if (last.metadata?.interrupted) return 'lost';
  if (last.metadata?.stopped) return 'stopped';
  if (last.metadata?.error) return 'failed';
  return 'answered';
}

// The tool the answer is running right now — its last part is a tool call whose result
// has not come back — so the composer can say "Home nutzt web_search …" instead of a
// bare "schreibt …" while nothing new appears for a while.
export function activeTool(messages: PlanUIMessage[], status: ChatStatus): string | null {
  if (status !== 'submitted' && status !== 'streaming') return null;
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return null;
  const part = last.parts.at(-1);
  if (part?.type !== 'dynamic-tool') return null;
  return part.state === 'input-streaming' || part.state === 'input-available'
    ? part.toolName
    : null;
}

// A question the agent asked with fixed answers to pick from — Hermes' `clarify` tool
// with its `choices` — still open at the end of the conversation. Only such a
// structured question gets its answers offered as chips over the input; any other
// question is answered in the input field like every other message.
export interface PendingChoices {
  question: string;
  choices: string[];
}

const CLARIFY_TOOLS = new Set(['clarify', 'ask_user', 'ask_clarification']);

export function pendingChoices(messages: PlanUIMessage[]): PendingChoices | null {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return null;
  const tool = [...last.parts]
    .reverse()
    .find(
      (part): part is DynamicToolUIPart =>
        part.type === 'dynamic-tool' && CLARIFY_TOOLS.has(part.toolName),
    );
  if (!tool) return null;
  const input = tool.input as { question?: unknown; choices?: unknown } | undefined;
  const choices = Array.isArray(input?.choices)
    ? input.choices.filter((choice): choice is string => typeof choice === 'string' && !!choice)
    : [];
  if (choices.length === 0) return null;
  return {
    question: typeof input?.question === 'string' ? input.question : '',
    choices: choices.slice(0, 6),
  };
}
