import { memorySection } from '../prompt';
import type { SkillEntry } from '../config';
import type { HelenaApi } from '../helena-client';
import { error, text, type AgentTool } from './types';

// The loop's own tools: asking the person (clarify), finding more tools, loading a skill,
// the agent's memory and the search over past sessions.

export const clarifyTool: AgentTool = {
  name: 'clarify',
  kind: 'clarify',
  readOnly: true,
  description:
    'Ask the person a question and stop until they answer. Offer up to six short answers in `choices` when there are clear options. Use it only when you cannot go on without the answer.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      choices: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    },
    required: ['question'],
  },
  async execute(input) {
    const question = text(input.question).trim();
    if (!question) return error('No question.');
    return { text: 'The question is shown to the person. Wait for the answer.', endTurn: true };
  },
};

// A catalog of the tools not given directly (the rest of Helena's own and the library
// servers'): found by words of their name and description, callable from the next step on.
export interface ToolCatalogEntry {
  name: string;
  description: string;
}

function words(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/)
    .filter((word) => word.length > 1);
}

export function searchCatalog(
  catalog: ToolCatalogEntry[],
  query: string,
  limit = 6,
): ToolCatalogEntry[] {
  const wanted = words(query);
  if (wanted.length === 0) return [];
  return catalog
    .map((entry, index) => {
      const name = new Set(words(entry.name));
      const description = new Set(words(entry.description));
      let score = 0;
      for (const word of wanted) {
        if (name.has(word)) score += 3;
        else if ([...name].some((part) => part.startsWith(word))) score += 2;
        if (description.has(word)) score += 1;
      }
      return { entry, score, index };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((hit) => hit.entry);
}

export function findToolsTool(catalog: () => ToolCatalogEntry[]): AgentTool {
  return {
    name: 'find_tools',
    kind: 'meta',
    readOnly: true,
    description:
      'Find more tools by what you need (e.g. "create task", "calendar", "files of the vault"). The tools found can be called directly from your next step on.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    async execute(input) {
      const hits = searchCatalog(catalog(), text(input.query));
      if (hits.length === 0) return { text: 'No tool found. Try other words.' };
      return {
        text: `Now available:\n${hits
          .map((hit) => `- ${hit.name}: ${hit.description.split('\n')[0]!.slice(0, 160)}`)
          .join('\n')}`,
        activate: hits.map((hit) => hit.name),
      };
    },
  };
}

export function skillTool(skills: SkillEntry[]): AgentTool {
  return {
    name: 'load_skill',
    kind: 'meta',
    readOnly: true,
    description:
      'Load the instructions of one of your skills (listed in the system prompt) before you do what it covers. With `file`, one of its extra files.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, file: { type: 'string' } },
      required: ['name'],
    },
    async execute(input) {
      const name = text(input.name).trim().toLowerCase();
      const skill = skills.find((entry) => entry.name.toLowerCase() === name);
      if (!skill)
        return error(`No skill ${name}. Skills: ${skills.map((entry) => entry.name).join(', ')}`);
      const file = text(input.file).trim();
      if (!file) {
        const extra = (skill.files ?? []).map((entry) => entry.path);
        return {
          text: extra.length
            ? `${skill.markdown}\n\n(Extra files: ${extra.join(', ')})`
            : skill.markdown,
        };
      }
      const found = (skill.files ?? []).find((entry) => entry.path === file);
      return found ? { text: found.content } : error(`The skill has no file ${file}.`);
    },
  };
}

// Obvious facts, code and task contents are not memory; neither is a secret. The loop only
// states the rule; Helena checks a memory write for secrets where it lands.
const MEMORY_RULE =
  'Keep only what is not obvious and helps later: decisions, preferences, where things are, procedures that worked. Never a secret, a key or a password.';

export function memoryTool(api: HelenaApi): AgentTool {
  return {
    name: 'memory',
    description: `Your long-term memory in Helena. action "read" searches MEMORY.md, USER.md and recent daily notes with query (bounded excerpts); "note" adds a line to today's note; "propose" replaces MEMORY.md or USER.md (the owner may review it). ${MEMORY_RULE}`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'note', 'propose'] },
        query: { type: 'string', description: 'Words to find in memory and daily notes' },
        file: { type: 'string', enum: ['MEMORY.md', 'USER.md'] },
        content: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['action'],
    },
    async execute(input) {
      const action = text(input.action);
      if (action === 'read') {
        const state = await api.memory();
        return { text: memorySection(state, text(input.query), 6000) || '(no matching memory)' };
      }
      const content = text(input.content).trim();
      if (!content) return error('No content.');
      if (action === 'note') {
        await api.note(content.slice(0, 2000));
        return { text: "Added to today's note.", changed: true };
      }
      if (action === 'propose') {
        const file = text(input.file);
        if (file !== 'MEMORY.md' && file !== 'USER.md')
          return error('file must be MEMORY.md or USER.md');
        const answer = await api.proposeMemory(file, content, text(input.reason));
        return {
          text:
            answer.status === 'pending'
              ? 'Proposed; the owner reviews it before it takes effect.'
              : `Saved ${file}.`,
          changed: true,
        };
      }
      return error('action must be read, note or propose');
    },
  };
}

export function sessionSearchTool(api: HelenaApi): AgentTool {
  return {
    name: 'search_sessions',
    readOnly: true,
    description:
      "Search your past conversations and runs (and the other agents' ones you may read) by words or meaning. Use it before asking the person something they may have told you before.",
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    async execute(input) {
      const hits = await api.searchSessions(text(input.query));
      if (hits.length === 0) return { text: 'Nothing found.' };
      return {
        text: hits
          .map(
            (hit) => `- ${hit.title} (${hit.updatedAt.slice(0, 10)}, ${hit.ref}): ${hit.snippet}`,
          )
          .join('\n'),
      };
    },
  };
}
