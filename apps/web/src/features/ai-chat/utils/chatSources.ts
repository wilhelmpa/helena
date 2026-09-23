import type { PlanUIMessage } from './chatMessages';

// What an answer drew on or pointed at, collected from its text and its tool calls:
// the tasks it names ("WEB-12"), the vault notes and files it read or named, and the
// web pages it linked. Shown under the answer as its sources.
export type ChatSource =
  | { kind: 'task'; key: string; seq: number }
  | { kind: 'file'; path: string }
  | { kind: 'url'; url: string };

const TASK = /\b([A-Z][A-Z0-9_]{0,9})-(\d{1,6})\b/g;
// Vault file names commonly carry spaces ("Launch plan.md"), so only a newline and the
// characters that end a quote, a paren or a markdown link close the match — a plain
// space does not. The match is non-greedy, so it still stops at the first extension it
// finds rather than running on to a later, unrelated one.
const VAULT_PATH =
  /(?:^|[\s"'`(/[])((?:Projects\/[A-Z0-9_-]+|Home|Templates)\/[^\n\r"'`)\]<>]*?\.[A-Za-z0-9]{1,8})(?=$|[\s"'`)\]<>,;:])/g;
const URL = /\bhttps?:\/\/[^\s"'`)\]<>]+/g;

function textsOf(message: PlanUIMessage): string[] {
  const texts: string[] = [];
  for (const part of message.parts) {
    if (part.type === 'text') texts.push(part.text);
    if (part.type === 'dynamic-tool') {
      texts.push(typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? ''));
      if (part.state === 'output-available') {
        texts.push(typeof part.output === 'string' ? part.output : JSON.stringify(part.output));
      }
    }
  }
  return texts;
}

// `projectKeys` are the projects a task may belong to, so "UTF-8" or "ISO-9001" in a
// text is not taken for a task.
export function chatSources(message: PlanUIMessage, projectKeys: string[]): ChatSource[] {
  const keys = new Set(projectKeys);
  const seen = new Set<string>();
  const sources: ChatSource[] = [];
  const add = (id: string, source: ChatSource) => {
    if (seen.has(id)) return;
    seen.add(id);
    sources.push(source);
  };
  for (const text of textsOf(message)) {
    for (const [, key, seq] of text.matchAll(TASK)) {
      if (keys.has(key)) add(`task:${key}-${seq}`, { kind: 'task', key, seq: Number(seq) });
    }
    for (const [, path] of text.matchAll(VAULT_PATH)) add(`file:${path}`, { kind: 'file', path });
    for (const [url] of text.matchAll(URL)) {
      const clean = url.replace(/[.,;:!?]+$/, '');
      add(`url:${clean}`, { kind: 'url', url: clean });
    }
  }
  return sources;
}
