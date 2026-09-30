import type { NativeSkill, SkillChange } from '@/lib/api/endpoints/agentLearning';
import type { AgentInventorySkill } from '@/lib/api/endpoints/agents';
import type { AgentSkill } from '@/lib/api/endpoints/agentSkills';

// The skills of an agent as one list (the Skills tab of the agent dialog). Four kinds of
// skill reach an agent, each from another place:
//   library   a skill of the team's library, linked to the agent (turned on and off here)
//   bundled   shipped with the agent's runtime (Hermes), turned off by name
//   installed put into the runtime from a hub (Hermes), turned off by name
//   learned   written by the agent itself, with a history of versions
// Nothing here reads the network: the panel hands in what it fetched.

export type SkillKind = 'library' | 'bundled' | 'installed' | 'learned';
export type SkillView = 'assigned' | 'library' | 'proposals' | 'archive';

export interface SkillEntry {
  key: string;
  kind: SkillKind;
  // The name as people read it ("Git worktree arbeiten") and the id the agent loads it by.
  title: string;
  loadName: string;
  description: string;
  // On for the agent: linked (library), not turned off (bundled, installed), active (learned).
  enabled: boolean;
  pinned: boolean;
  useCount: number | null;
  lastUsedAt: string | null;
  version: number | null;
  libraryId: number | null;
  // The skill's directory in the runtime, which an action on it names it by.
  path: string | null;
  category: string | null;
  learned: NativeSkill | null;
  state: 'active' | 'proposed' | 'archived';
}

// "git-worktree-arbeiten" → "Git worktree arbeiten": what the runtime loads a skill by is
// an id; people read a name.
export function readableName(name: string): string {
  const spaced = name
    .replace(/^learned\//, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : name;
}

// The line under a skill's name: what it is for, in one sentence. A description starting with
// the "Wann verwenden:" of a learned skill loses that lead-in, since the column says it.
export function shortDescription(description: string | null | undefined): string {
  const text = (description ?? '')
    .replace(/^\s*(wann verwenden|use when|when to use)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  const sentence = text.match(/^.{12,}?[.!?](?=\s|$)/)?.[0] ?? text;
  return sentence.length > 200 ? `${sentence.slice(0, 197).trimEnd()}…` : sentence;
}

// The description a learned skill carries in its SKILL.md front matter.
export function markdownDescription(markdown: string): string {
  const front = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  return front.match(/^description:\s*(.*)$/m)?.[1]?.trim() ?? '';
}

// A version of a learned skill that waits for the owner: a new skill (proposed) or a change
// of a skill already in use.
export function pendingChange(skill: NativeSkill): SkillChange | null {
  return skill.history?.find((change) => change.status === 'pending') ?? null;
}

function learnedEntry(skill: NativeSkill): SkillEntry {
  const state = skill.proposed ? 'proposed' : skill.archived ? 'archived' : 'active';
  return {
    key: `learned:${skill.path}`,
    kind: 'learned',
    title: readableName(skill.name),
    loadName: skill.name,
    description: shortDescription(markdownDescription(skill.markdown)),
    enabled: state === 'active',
    pinned: skill.pinned === true,
    useCount: skill.useCount ?? null,
    lastUsedAt: skill.lastUsedAt ?? null,
    version: skill.version ?? null,
    libraryId: null,
    path: skill.path,
    category: null,
    learned: skill,
    state,
  };
}

export function skillEntries({
  library,
  assignedIds,
  inventory,
  disabled,
  native,
}: {
  library: AgentSkill[];
  assignedIds: number[];
  inventory: AgentInventorySkill[];
  disabled: string[];
  native: NativeSkill[];
}): SkillEntry[] {
  const entries: SkillEntry[] = [];
  const linked = new Set(assignedIds);
  for (const skill of library) {
    entries.push({
      key: `library:${skill.id}`,
      kind: 'library',
      title: readableName(skill.name),
      loadName: skill.name,
      description: shortDescription(skill.description),
      enabled: linked.has(skill.id),
      pinned: false,
      useCount: null,
      lastUsedAt: null,
      version: null,
      libraryId: skill.id,
      path: null,
      category: null,
      learned: null,
      state: 'active',
    });
  }
  const libraryNames = new Set(library.map((skill) => skill.name.toLowerCase()));
  const nativePaths = new Set(native.map((skill) => skill.path));
  for (const skill of inventory) {
    // The library's own skills reach the runtime under their name: the library lists them.
    if (skill.origin === 'plan' || libraryNames.has(skill.name.toLowerCase())) continue;
    if (skill.origin === 'agent') {
      // With its history the skill comes from the native list below.
      if (skill.path && nativePaths.has(skill.path)) continue;
      entries.push({
        key: `learned:${skill.path ?? skill.name}`,
        kind: 'learned',
        title: readableName(skill.name),
        loadName: skill.name,
        description: shortDescription(skill.description),
        enabled: !disabled.includes(skill.name),
        pinned: skill.pinned === true,
        useCount: null,
        lastUsedAt: null,
        version: null,
        libraryId: null,
        path: skill.path ?? null,
        category: skill.category,
        learned: null,
        state: 'active',
      });
      continue;
    }
    entries.push({
      key: `${skill.origin}:${skill.name}`,
      kind: skill.origin === 'hub' ? 'installed' : 'bundled',
      title: readableName(skill.name),
      loadName: skill.name,
      description: shortDescription(skill.description),
      enabled: !disabled.includes(skill.name),
      pinned: false,
      useCount: null,
      lastUsedAt: null,
      version: null,
      libraryId: null,
      path: null,
      category: skill.category,
      learned: null,
      state: 'active',
    });
  }
  for (const skill of native) entries.push(learnedEntry(skill));
  return entries;
}

// The entries a view shows. "Zugeordnet": everything the agent has on. "Bibliothek": the whole
// team library, to add from. "Vorschläge": what the agent proposes and waits for a decision,
// a new skill or a change of one. "Archiv": learned skills put away.
export function inView(entries: SkillEntry[], view: SkillView): SkillEntry[] {
  switch (view) {
    case 'assigned':
      return entries.filter((entry) =>
        entry.kind !== 'library' ? entry.state === 'active' && entry.enabled : entry.enabled,
      );
    case 'library':
      return entries.filter((entry) => entry.kind === 'library');
    case 'proposals':
      return entries.filter(
        (entry) => entry.learned && (entry.state === 'proposed' || pendingChange(entry.learned)),
      );
    case 'archive':
      return entries.filter((entry) => entry.state === 'archived');
  }
}

export function matchesQuery(entry: SkillEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [entry.title, entry.loadName, entry.description, entry.category ?? ''].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

const KIND_ORDER: SkillKind[] = ['learned', 'library', 'installed', 'bundled'];

// The entries of one view in groups by kind, in a fixed order; a pinned skill leads its group.
export function groupByKind(entries: SkillEntry[]): [SkillKind, SkillEntry[]][] {
  return KIND_ORDER.map((kind): [SkillKind, SkillEntry[]] => [
    kind,
    entries
      .filter((entry) => entry.kind === kind)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.title.localeCompare(b.title, 'de')),
  ]).filter(([, list]) => list.length > 0);
}

// Who made a version, as a key of `agentPages.skills.actor`, with the user's id when it was a
// person.
export function actorOf(actor: string): 'agent' | 'user' | 'curator' | 'owner' | 'system' {
  if (actor.startsWith('agent:')) return 'agent';
  if (actor.startsWith('user:')) return 'user';
  if (actor === 'curator') return 'curator';
  if (actor.startsWith('runtime-action:')) return 'owner';
  return 'system';
}

const KNOWN_CHANGES = [
  'create',
  'update',
  'pin',
  'unpin',
  'archive',
  'restore',
  'approve',
  'reject',
  'discard-skill',
  'pin-skill',
] as const;

export type ChangeKind = (typeof KNOWN_CHANGES)[number] | 'merge' | 'archiveUnused' | 'other';

// What a version did, as a key of `agentPages.skills.action`.
export function changeKind(action: string): ChangeKind {
  if (action.startsWith('merge:')) return 'merge';
  if (action.startsWith('archive:')) return 'archiveUnused';
  return (KNOWN_CHANGES as readonly string[]).includes(action) ? (action as ChangeKind) : 'other';
}
