import type { Logger } from './common';
import type { LocalizedText } from './text';

// What Helena runs on and whether a newer version of it exists: Hermes, the CLI runtimes,
// the system's packages, the tools of the host. An update source answers with facts it read
// from the installation and from the vendor's published data; it never asks a model. What
// changed in a new version is summarized later, from the release notes the source fetches.
// Decision: docs/helena-decisions/update-center.md.

// `runtime`: an agent runtime (Hermes, Claude Code, Codex, an ACP adapter). `system`: the
// operating system's packages. `tool`: a program Helena's services run on (Bun, Node,
// code-server). `app`: Helena itself or a plugin.
export type UpdateKind = 'runtime' | 'system' | 'tool' | 'app';

export const UPDATE_KINDS: readonly UpdateKind[] = ['runtime', 'system', 'tool', 'app'];

// How risky taking the update looks, as the summary rates it.
export type UpdateRisk = 'low' | 'medium' | 'high';

export const UPDATE_RISKS: readonly UpdateRisk[] = ['low', 'medium', 'high'];

// One component of a source: a runtime, a Debian source package, a tool.
export interface UpdateCandidate {
  // Stable within the source: `claude`, `openssl`, `bun`.
  component: string;
  // What a person reads: `Claude Code`, `openssl`.
  name: string;
  // Null when the component is not installed here or its version could not be read.
  installed: string | null;
  // The newest version the vendor offers; null when it could not be read.
  available: string | null;
  // Whether `available` is newer than `installed`. The source decides (apt names its
  // candidate; a registry version is compared with compareVersions).
  updateAvailable: boolean;
  // The update fixes a vulnerability (a security archive, an advisory against the
  // installed version).
  security: boolean;
  // Where the component comes from, and where its release notes are for a person.
  sourceUrl?: string | null;
  notesUrl?: string | null;
  // Candidates of one group (all Debian packages) share one summary.
  group?: string | null;
  // Whether this source can apply the update (a helper does the work).
  applicable: boolean;
  // Why it cannot, or where it is installed from: shown next to the component.
  hint?: LocalizedText | null;
  // A short fact line: "3 packages", "10 commits", "held back by the pin".
  detail?: string | null;
  // The check of this component failed; the rest of the source still counts.
  error?: string | null;
  // Anything the source needs back when applying (the binary packages of a source package).
  data?: Record<string, unknown> | null;
}

export interface UpdateFetchOptions {
  // At most this many bytes are read (default 512 KiB); the rest is dropped.
  maxBytes?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
}

// What a source gets for its check. `fetchText` reaches only the hosts the source declared
// (`hosts`), follows redirects only to those, times out and bounds what it reads.
export interface UpdateCheckContext {
  now: Date;
  log: Logger;
  signal?: AbortSignal;
  // Whether the person asked for this check ("Jetzt prüfen"), rather than the schedule.
  manual: boolean;
  fetchText(url: string, options?: UpdateFetchOptions): Promise<string>;
  fetchJson<T = unknown>(url: string, options?: UpdateFetchOptions): Promise<T>;
  // The facts a helper on the host reported (installed versions, the package manager's
  // candidates), or null when no helper is installed.
  inventory(): Promise<Record<string, unknown> | null>;
}

// An update the owner asked for: the component and the version it is to reach.
export interface UpdateApplyRequest {
  component: string;
  // The version the check found; the source applies this one, or refuses.
  target: string;
  candidate: UpdateCandidate;
  // All components of the candidate's group the owner chose (Debian: "Alle Sicherheitsupdates").
  components?: UpdateCandidate[];
}

export interface UpdateApplyContext {
  log: Logger;
  // The person who asked: the owner's click is the approval of the download.
  userId: string;
}

// Started: `ref` follows the work with `progress`. A source that finished at once answers
// the final progress right away.
export interface UpdateApplyStarted {
  ref: string;
  progress?: UpdateProgress;
}

export interface UpdateProgress {
  state: 'running' | 'done' | 'failed';
  // What the helper printed, newest last, bounded.
  log?: string | null;
  error?: string | null;
  // What changed (old and new versions), the health afterwards, the way back.
  result?: Record<string, unknown> | null;
}

// An update source (registry `updateSources`). `check` runs on every check; `releaseNotes`
// only for a version that has no summary yet; `apply`/`progress` only where a helper can do
// the work.
export interface UpdateSource {
  id: string;
  label: LocalizedText;
  kind: UpdateKind;
  // Lower comes first in the list; built-ins leave gaps of 10.
  order?: number;
  // The hosts `fetchText` may reach for this source, exact names (`registry.npmjs.org`).
  hosts?: string[];
  check(context: UpdateCheckContext): Promise<UpdateCandidate[]>;
  // The notes between `installed` and `available`, as plain text or Markdown. Untrusted:
  // Helena passes them to the summary as data. Null when there are none to read.
  releaseNotes?(candidate: UpdateCandidate, context: UpdateCheckContext): Promise<string | null>;
  apply?(request: UpdateApplyRequest, context: UpdateApplyContext): Promise<UpdateApplyStarted>;
  progress?(ref: string, context: UpdateApplyContext): Promise<UpdateProgress>;
}

// ── Versions ────────────────────────────────────────────────────────────────────────────

interface ParsedVersion {
  numbers: number[];
  pre: string[];
}

// `v1.2.3`, `1.2.3-beta.1`, `2026.9.24`, `4.138.0`: numeric parts, then an optional
// prerelease. Build metadata (`+…`) is ignored. Null for anything else.
function parseVersion(value: string): ParsedVersion | null {
  const match = /^[vV]?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  return {
    numbers: match[1]!.split('.').map(Number),
    pre: match[2] ? match[2].split('.') : [],
  };
}

export function isPrerelease(value: string): boolean {
  const parsed = parseVersion(value);
  return parsed !== null && parsed.pre.length > 0;
}

function comparePre(a: string[], b: string[]): number {
  // A release is newer than any of its prereleases.
  if (a.length === 0 || b.length === 0) return a.length === 0 ? (b.length === 0 ? 0 : 1) : -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumber = /^\d+$/.test(left);
    const rightNumber = /^\d+$/.test(right);
    if (leftNumber && rightNumber && Number(left) !== Number(right))
      return Number(left) - Number(right);
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

// Semver precedence, for any number of numeric parts (missing parts count as 0). Null when
// either side is not a version (a Debian revision, a commit): the caller decides then.
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < Math.max(left.numbers.length, right.numbers.length); i++) {
    const difference = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return comparePre(left.pre, right.pre);
}

// Whether `available` is newer than `installed`; false when either is missing or cannot be
// compared.
export function isNewerVersion(
  available: string | null | undefined,
  installed: string | null | undefined,
): boolean {
  if (!available || !installed) return false;
  const order = compareVersions(available, installed);
  return order !== null && order > 0;
}

// ── Checking what a source answered ─────────────────────────────────────────────────────

const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._:+@/-]{0,127}$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function url(value: unknown): string | null {
  const found = text(value, 2_000);
  if (!found) return null;
  try {
    const parsed = new URL(found);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function localized(value: unknown): LocalizedText | null {
  if (typeof value === 'string') return text(value, 500);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, entry]) => /^[A-Za-z-]{2,10}$|^i18n$/.test(key) && typeof entry === 'string')
    .slice(0, 20)
    .map(([key, entry]) => [key, (entry as string).slice(0, 500)]);
  return entries.length ? (Object.fromEntries(entries) as LocalizedText) : null;
}

// A candidate as Helena stores it, or null when it is unusable (no component or name).
// Everything a source hands over passes through here, a plugin's included.
export function normalizeUpdateCandidate(value: unknown): UpdateCandidate | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const component = text(raw.component, 128);
  if (!component || !COMPONENT.test(component)) return null;
  const name = text(raw.name, 200) ?? component;
  const installed = text(raw.installed, 100);
  const available = text(raw.available, 100);
  const data =
    raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
      ? (raw.data as Record<string, unknown>)
      : null;
  return {
    component,
    name,
    installed,
    available,
    updateAvailable: raw.updateAvailable === true && available !== null,
    security: raw.security === true,
    sourceUrl: url(raw.sourceUrl),
    notesUrl: url(raw.notesUrl),
    group: text(raw.group, 64),
    applicable: raw.applicable === true,
    hint: localized(raw.hint),
    detail: text(raw.detail, 300),
    error: text(raw.error, 500),
    data,
  };
}

// ── Reading the list ────────────────────────────────────────────────────────────────────

const RISK_RANK: Record<UpdateRisk, number> = { low: 1, medium: 2, high: 3 };

export function isUpdateRisk(value: unknown): value is UpdateRisk {
  return typeof value === 'string' && (UPDATE_RISKS as readonly string[]).includes(value);
}

// The order the owner reads updates in: a security update first, then by risk (high first,
// unrated last), then anything else that has an update, then the rest.
export function updatePriority(entry: {
  updateAvailable: boolean;
  security: boolean;
  risk?: UpdateRisk | null;
}): number {
  if (!entry.updateAvailable) return 0;
  return (entry.security ? 100 : 10) + (entry.risk ? RISK_RANK[entry.risk] : 0);
}
