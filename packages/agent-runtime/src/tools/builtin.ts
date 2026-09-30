import { memorySection } from '../prompt';
import type { SkillEntry } from '../config';
import type { HelenaApi, MemoryState } from '../helena-client';
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

const GERMAN_TOOL_WORDS: Record<string, string[]> = {
  aufgabe: ['issue', 'issues', 'task'],
  aufgaben: ['issues', 'tasks'],
  ticket: ['issue'],
  kommentar: ['comment'],
  kommentare: ['comments'],
  kommentiere: ['comment'],
  schreibe: ['add', 'create'],
  ziel: ['goal'],
  ziele: ['goals'],
  wissen: ['knowledge'],
  projektwissen: ['search', 'knowledge'],
  datei: ['file'],
  dateien: ['files'],
  mail: ['mail'],
  entwurf: ['draft'],
  antwort: ['reply'],
  kalender: ['calendar'],
  kalendereintrag: ['calendar', 'event'],
  katalog: ['catalog', 'lookup'],
  testkatalog: ['catalog', 'lookup'],
  datensatz: ['item', 'lookup'],
  eintrag: ['item', 'lookup'],
  termin: ['event'],
  termine: ['events'],
  zeitplan: ['schedule'],
  entscheidung: ['decisions', 'decision'],
  entscheidungsfunktion: ['decide'],
  entscheide: ['decide'],
  wähle: ['decide'],
  freigabe: ['approval', 'approvals'],
  testfreigabe: ['approval'],
  genehmigung: ['approval'],
  agent: ['agent'],
  agenten: ['ai', 'agents'],
  depot: ['positions', 'account'],
  positionen: ['positions'],
  browser: ['browser'],
  suche: ['search'],
  suchen: ['search'],
  finden: ['search'],
  lesen: ['read'],
  anzeigen: ['get', 'list'],
  welche: ['list'],
  welcher: ['list'],
  welchen: ['get'],
  auflisten: ['list'],
  erstellen: ['create'],
  erstelle: ['create'],
  lege: ['create'],
  anlegen: ['create'],
  ändern: ['update'],
  bearbeiten: ['update'],
  löschen: ['delete'],
};

function queryWords(query: string): string[] {
  return [...new Set(words(query).flatMap((word) => [word, ...(GERMAN_TOOL_WORDS[word] ?? [])]))];
}

export function searchCatalog(
  catalog: ToolCatalogEntry[],
  query: string,
  limit = 6,
): ToolCatalogEntry[] {
  const wanted = queryWords(query);
  if (wanted.length === 0) return [];
  const queryText = query.toLowerCase();
  return catalog
    .map((entry, index) => {
      const name = new Set(words(entry.name));
      const description = new Set(words(entry.description));
      let score = 0;
      const exactName = entry.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?:^|[^a-z0-9_])${exactName}(?:$|[^a-z0-9_])`).test(queryText)) score += 100;
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
      const hits = searchCatalog(catalog(), text(input.query), 4);
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

export function skillTool(
  skills: SkillEntry[],
  used?: (name: string) => Promise<void>,
  maxLoaded = 8,
): AgentTool {
  const loaded = new Set<string>();
  return {
    name: 'load_skill',
    kind: 'meta',
    readOnly: true,
    description:
      'Load and follow a matching skill before acting. The tool is load_skill; name is its argument, and load_name is not a tool. With file, load a reference or script source (execution still requires shell policy). Follow the returned offset instructions until every page is read before acting. offset is a zero-based line index; limit is the number of lines. Use next offset for the next page.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        file: { type: 'string' },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      required: ['name'],
    },
    async execute(input) {
      const name = text(input.name).trim().toLowerCase();
      const skill = skills.find((entry) => entry.name.toLowerCase() === name);
      if (!skill)
        return error(`No skill ${name}. Skills: ${skills.map((entry) => entry.name).join(', ')}`);
      if (!loaded.has(skill.name) && loaded.size >= maxLoaded)
        return error(
          `Skill loading limit ${maxLoaded} reached. Finish with the skills already loaded.`,
        );
      const file = text(input.file).trim();
      const offset = input.offset ?? 0;
      const limit = input.limit ?? 200;
      if (
        typeof offset !== 'number' ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        typeof limit !== 'number' ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 500
      )
        return error('offset must be a nonnegative line index and limit must be 1–500 lines');
      const page = (content: string, extra: string[] = []) => {
        const lines = content.split('\n');
        if (offset > lines.length) return error('Offset is beyond the file.');
        let end = offset;
        let chars = 0;
        while (end < Math.min(offset + limit, lines.length)) {
          const size = lines[end]!.length + 1;
          if (chars + size > 10_000) break;
          chars += size;
          end++;
        }
        if (end === offset && offset < lines.length)
          return error('A skill line exceeds 10000 characters. Split it into shorter lines.');
        return {
          text:
            lines.slice(offset, end).join('\n') +
            (end < lines.length
              ? `\n(Next offset: ${end}; total lines: ${lines.length})`
              : '\n(End of file)') +
            (extra.length ? `\n(Extra files: ${extra.join(', ')})` : ''),
        };
      };
      if (!file) {
        await used?.(skill.name);
        loaded.add(skill.name);
        const extra = (skill.files ?? []).map((entry) => entry.path);
        return page(skill.markdown, extra);
      }
      const found = (skill.files ?? []).find((entry) => entry.path === file);
      if (found) loaded.add(skill.name);
      return found ? page(found.content) : error(`The skill has no file ${file}.`);
    },
  };
}

// Obvious facts, code and task contents are not memory; neither is a secret. The loop only
// states the rule; Helena checks a memory write for secrets where it lands.
const MEMORY_RULE =
  'Keep only what is not obvious and helps later: decisions, preferences, where things are, procedures that worked. Never a secret, a key or a password.';

export function memoryTool(
  api: HelenaApi,
  sessionId?: () => string | undefined,
  initial?: MemoryState | null,
): AgentTool {
  let cached = initial;
  return {
    name: 'memory',
    description: `Your long-term memory in Helena. Relevant excerpts are already in the prompt; read only for missing details, not every round. action "read" searches MEMORY.md, USER.md and recent daily notes with query; "note" adds a durable fact; "propose" replaces MEMORY.md or USER.md (the owner may review it). ${MEMORY_RULE}`,
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
        const state = cached ?? (cached = await api.memory());
        return { text: memorySection(state, text(input.query), 6000) || '(no matching memory)' };
      }
      const content = text(input.content).trim();
      if (!content) return error('No content.');
      if (action === 'note') {
        const note = content.slice(0, 2000);
        await api.note(note, sessionId?.());
        cached = await api.memory().catch(() => null);
        const normalized = note.replace(/\s+/g, ' ').trim().toLowerCase();
        const saved = cached?.notes.some((entry) =>
          entry.content.split('\n').some(
            (line) =>
              line
                .replace(/^-\s+\d{2}:\d{2}\s+/, '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase() === normalized,
          ),
        );
        return {
          text: saved
            ? "Saved today's note."
            : cached?.approval
              ? "Submitted today's note for owner approval."
              : 'The note request succeeded, but the note is not yet visible in memory.',
          changed: true,
        };
      }
      if (action === 'propose') {
        const file = text(input.file);
        if (file !== 'MEMORY.md' && file !== 'USER.md')
          return error('file must be MEMORY.md or USER.md');
        const answer = await api.proposeMemory(file, content, text(input.reason), sessionId?.());
        cached = null;
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

export function learnSkillTool(
  api: HelenaApi,
  options: {
    sessionId?: () => string | undefined;
    allowCreate?: () => boolean;
  } = {},
): AgentTool {
  return {
    name: 'skill_manage',
    description:
      'Manage reusable learned procedures. list reads skills and revisions. create requires name, path and markdown; update replaces markdown of an existing path; patch replaces exactly one occurrence of oldText with newText. Edits require baseRevision from list. Use Agent Skills frontmatter (name, description explaining when to use) and nonempty ## Steps, ## Pitfalls, ## Examples sections. Improve a similar existing skill instead of duplicating it. Keep secrets and credential paths out. Preserve reference files.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'update', 'patch'] },
        path: {
          type: 'string',
          description:
            'Exact skill directory key from list, e.g. csv-import, not a filesystem path.',
        },
        name: { type: 'string' },
        markdown: { type: 'string' },
        oldText: { type: 'string' },
        newText: { type: 'string' },
        baseRevision: { type: ['string', 'null'] },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content'],
          },
        },
      },
      required: ['action'],
    },
    async execute(input) {
      if (!api.learnedSkills || !api.saveSkill) return error('Skill learning unavailable');
      const skills = await api.learnedSkills(true);
      if (input.action === 'list') return { text: JSON.stringify(skills) };
      if (!['create', 'update', 'patch'].includes(text(input.action)))
        return error('Unsupported skill action');
      if (input.action === 'create' && options.allowCreate?.() === false)
        return error('A failed task may only improve an existing skill');
      const requestedPath = text(input.path) || (input.action === 'create' ? text(input.name) : '');
      const normalizedPath = requestedPath.replace(/^skills\//, '').replace(/\/SKILL\.md$/, '');
      const current =
        skills.find((skill) => skill.path === requestedPath) ??
        skills.find((skill) => skill.path === normalizedPath);
      if (input.action !== 'create' && !current)
        return error(
          `Unknown skill path. Use the directory key from list: ${skills.map((skill) => skill.path).join(', ')}`,
        );
      if (input.action !== 'create' && current?.revision !== input.baseRevision)
        return error(
          'Read the current skill revision with list and pass its exact baseRevision string before editing',
        );
      const duplicate = skills.find(
        (skill) => skill.name.toLowerCase() === text(input.name).toLowerCase(),
      );
      if (input.action === 'create' && (current || duplicate))
        return error(
          `Improve existing skill ${current?.path ?? duplicate?.path} with update or patch and its revision`,
        );
      let markdown = text(input.markdown);
      if (input.action === 'patch') {
        const old = text(input.oldText);
        if (!old || current!.markdown.split(old).length !== 2)
          return error('oldText must match exactly once');
        markdown = current!.markdown.replace(old, text(input.newText));
      }
      const files = input.files === undefined ? (current?.files ?? []) : input.files;
      if (
        !Array.isArray(files) ||
        files.some(
          (file) => !file || typeof file.path !== 'string' || typeof file.content !== 'string',
        )
      )
        return error('Invalid skill files');
      const saved = await api.saveSkill(
        {
          path: current?.path ?? requestedPath,
          name: text(input.name) || current?.name || '',
          markdown,
          files,
          truncated: false,
          otherFiles: 0,
        },
        current?.revision ?? null,
        { sessionId: options.sessionId?.(), structured: true },
      );
      return {
        text: JSON.stringify({
          path: saved.path,
          revision: saved.revision,
          status: saved.status ?? 'applied',
          change: saved.change,
        }),
        changed: saved.status !== 'pending',
      };
    },
  };
}
