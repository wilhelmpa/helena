import ar from '../messages/ar/defaults.json';
import de from '../messages/de/defaults.json';
import en from '../messages/en/defaults.json';
import esES from '../messages/es-ES/defaults.json';
import fr from '../messages/fr/defaults.json';
import id from '../messages/id/defaults.json';
import ptBR from '../messages/pt-BR/defaults.json';
import ru from '../messages/ru/defaults.json';
import uk from '../messages/uk/defaults.json';
import zhCN from '../messages/zh-CN/defaults.json';
import { DEFAULT_LOCALE, LOCALES, type Locale } from './index';

// The names Helena gives the data it creates for a person: a new project's states, issue
// types and views, its coordinator agent, a new team's default role, the label an agent
// puts on a task it cannot go on with. They are written in the language of the person
// the data is made for and are ordinary data from then on: people rename them freely,
// and nothing reads them back as identifiers except through `findState` below.
//
// The texts are translation files like the web's (messages/<locale>/defaults.json, English
// the source), so a new language is a new file. The structure (which states, which types
// a preset makes, their colors) is code and the same in every language. Decision:
// docs/helena-decisions/default-data-i18n.md.

export type DefaultNames = typeof en;

const CATALOG: Record<Locale, DefaultNames> = {
  en,
  de,
  fr,
  'es-ES': esES,
  'pt-BR': ptBR,
  id,
  ru,
  uk,
  'zh-CN': zhCN,
  ar,
};

export function defaultNames(locale: Locale): DefaultNames {
  return CATALOG[locale] ?? CATALOG[DEFAULT_LOCALE];
}

// ── States ────────────────────────────────────────────────────────────────────────────

export type DefaultStateKey = keyof DefaultNames['states'];
export type StateType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

// Every new project starts with a complete working flow, including the review checkpoint
// agent-team runs stop at before completed work reaches Done.
export const DEFAULT_STATES: readonly {
  key: DefaultStateKey;
  stateType: StateType;
  color: string;
}[] = [
  { key: 'backlog', stateType: 'backlog', color: '#71717a' },
  { key: 'todo', stateType: 'unstarted', color: '#6b7280' },
  { key: 'inProgress', stateType: 'started', color: '#eab308' },
  { key: 'review', stateType: 'started', color: '#8b5cf6' },
  { key: 'done', stateType: 'completed', color: '#22c55e' },
  { key: 'canceled', stateType: 'canceled', color: '#ef4444' },
];

export function defaultStates(locale: Locale) {
  const names = defaultNames(locale).states;
  return DEFAULT_STATES.map((state) => ({ ...state, name: names[state.key] }));
}

const normalized = (name: string) => name.trim().toLowerCase();

// Every language's name of a default state, so a state can be recognized whatever
// language its project was set up in.
const STATE_BY_NAME = new Map<string, DefaultStateKey>();
for (const locale of LOCALES) {
  for (const { key } of DEFAULT_STATES) {
    STATE_BY_NAME.set(normalized(CATALOG[locale].states[key]), key);
  }
}

// The default state a name is, in any shipped language ("Review", "In Prüfung",
// "审核中" → review), or null for a name of the project's own.
export function defaultStateKey(name: string): DefaultStateKey | null {
  return STATE_BY_NAME.get(normalized(name)) ?? null;
}

// The state a workflow, trigger or agent team means by a name. A state of exactly that
// name (ignoring case and outer spaces) wins; otherwise a default state is found under its
// name in any language, so a workflow that says "Review" also works in a project whose
// review state is called "In Prüfung". A state the project renamed is found only by its
// new name.
export function findState<T extends { name: string }>(
  states: readonly T[],
  reference: string,
): T | undefined {
  const wanted = normalized(reference);
  const exact = states.find((state) => normalized(state.name) === wanted);
  if (exact) return exact;
  const key = STATE_BY_NAME.get(wanted);
  return key ? states.find((state) => defaultStateKey(state.name) === key) : undefined;
}

// ── Issue types ───────────────────────────────────────────────────────────────────────

export type IssueTypeKey = keyof DefaultNames['issueTypes'];

// The spheres of work the create dialog offers, in its order.
export const PROJECT_PRESET_KEYS = [
  'general',
  'software',
  'product',
  'content',
  'marketing',
  'design',
  'sales',
  'operations',
  'support',
  'recruiting',
] as const;

export type ProjectPresetKey = (typeof PROJECT_PRESET_KEYS)[number];

// The issue types a new project starts with, picked by sphere of work in the create
// dialog. The first entry becomes the project's default type. "general" is the fallback
// when no preset is chosen: a single Task, so the project is usable without committing
// to a classification.
export const PROJECT_PRESETS: Record<
  ProjectPresetKey,
  readonly { type: IssueTypeKey; color: string }[]
> = {
  general: [{ type: 'task', color: '#0ea5e9' }],
  software: [
    { type: 'feature', color: '#8b5cf6' },
    { type: 'bug', color: '#e11d48' },
    { type: 'task', color: '#0ea5e9' },
    { type: 'techDebt', color: '#f97316' },
    { type: 'research', color: '#14b8a6' },
  ],
  product: [
    { type: 'epic', color: '#8b5cf6' },
    { type: 'feature', color: '#0ea5e9' },
    { type: 'feedback', color: '#eab308' },
    { type: 'research', color: '#14b8a6' },
  ],
  content: [
    { type: 'article', color: '#0ea5e9' },
    { type: 'video', color: '#e11d48' },
    { type: 'socialPost', color: '#8b5cf6' },
    { type: 'idea', color: '#eab308' },
    { type: 'review', color: '#22c55e' },
  ],
  marketing: [
    { type: 'campaign', color: '#8b5cf6' },
    { type: 'landing', color: '#0ea5e9' },
    { type: 'asset', color: '#14b8a6' },
    { type: 'email', color: '#f97316' },
    { type: 'research', color: '#22c55e' },
  ],
  design: [
    { type: 'screen', color: '#0ea5e9' },
    { type: 'component', color: '#8b5cf6' },
    { type: 'asset', color: '#14b8a6' },
    { type: 'research', color: '#22c55e' },
  ],
  sales: [
    { type: 'lead', color: '#0ea5e9' },
    { type: 'deal', color: '#22c55e' },
    { type: 'followUp', color: '#eab308' },
    { type: 'account', color: '#8b5cf6' },
  ],
  operations: [
    { type: 'request', color: '#0ea5e9' },
    { type: 'process', color: '#8b5cf6' },
    { type: 'purchase', color: '#22c55e' },
    { type: 'maintenance', color: '#f97316' },
  ],
  support: [
    { type: 'incident', color: '#e11d48' },
    { type: 'request', color: '#0ea5e9' },
    { type: 'question', color: '#eab308' },
    { type: 'change', color: '#8b5cf6' },
  ],
  recruiting: [
    { type: 'candidate', color: '#0ea5e9' },
    { type: 'onboarding', color: '#22c55e' },
    { type: 'request', color: '#8b5cf6' },
    { type: 'policy', color: '#6b7280' },
  ],
};

export const DEFAULT_PROJECT_PRESET: ProjectPresetKey = 'general';

export function isProjectPreset(value: unknown): value is ProjectPresetKey {
  return typeof value === 'string' && Object.hasOwn(PROJECT_PRESETS, value);
}

// The types a preset creates, in order, named in `locale`. An unknown preset is
// "general".
export function presetIssueTypes(preset: string | undefined, locale: Locale) {
  const names = defaultNames(locale).issueTypes;
  const entries = PROJECT_PRESETS[isProjectPreset(preset) ? preset : DEFAULT_PROJECT_PRESET];
  return entries.map(({ type, color }) => ({ key: type, name: names[type], color }));
}

// ── Views ─────────────────────────────────────────────────────────────────────────────

export type DefaultViewKey = 'kanban' | 'list';

// The views every project has: its board and its list of all tasks.
export const DEFAULT_VIEWS: readonly { key: DefaultViewKey; layout: 'kanban' | 'table' }[] = [
  { key: 'kanban', layout: 'kanban' },
  { key: 'list', layout: 'table' },
];

// A default view's name in every language, for finding the view a project already has.
export function defaultViewNames(key: DefaultViewKey): string[] {
  return [...new Set(LOCALES.map((locale) => CATALOG[locale].views[key]))];
}

// The default view a name is, in any shipped language ("List", "Liste" → list), or null.
export function defaultViewKey(name: string): DefaultViewKey | null {
  const wanted = normalized(name);
  return (
    DEFAULT_VIEWS.find(({ key }) =>
      LOCALES.some((locale) => normalized(CATALOG[locale].views[key]) === wanted),
    )?.key ?? null
  );
}

// The words a default view's name gets in brackets when a filtered view of the project
// already carries its plain name ("List (All tasks)"), in every language.
export function allTasksSuffixes(): string[] {
  return [...new Set(LOCALES.map((locale) => CATALOG[locale].views.allTasks))];
}

// ── Agents, teams, labels ─────────────────────────────────────────────────────────────

// The display name of a project's coordinator agent ("Hermes-Koordinator VOL"). Its
// handle stays hermes-<key>-coordinator in every language.
export function coordinatorName(projectKey: string, locale: Locale): string {
  return defaultNames(locale).coordinator.replace('{key}', projectKey);
}

// The role a new team's projects give people by default.
export function defaultRoleName(locale: Locale): string {
  return defaultNames(locale).teamRole;
}

// The label an agent puts on a task it cannot go on with, and the words its question
// starts with.
export function blockedLabelName(locale: Locale): string {
  return defaultNames(locale).blocked.label;
}

export function blockedLabelNames(): string[] {
  return [...new Set(LOCALES.map((locale) => CATALOG[locale].blocked.label))];
}

export function blockedCommentPrefix(locale: Locale): string {
  return defaultNames(locale).blocked.comment;
}
