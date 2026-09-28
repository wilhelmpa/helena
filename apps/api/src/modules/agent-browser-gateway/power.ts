import { db, getSetting, project, setSetting } from '@repo/db';
import { HttpError } from '#shared/lib';
import { HOME_SLUG, projectSlug } from '#shared/agent-socket';

// Project browsers on demand (docs/plan-lokal-halogen.md, Phase 6.1): a project's browser runs
// only while someone watches it or an agent uses it, and the browser router stops it after
// `idleMinutes` without use (0: never). Projects in `alwaysOnProjectIds`, and Home's browser with
// `homeAlwaysOn`, are started and kept running. One instance-wide setting (app_setting
// 'browser-power', Helena → Einstellungen → Browser); the router reads it as slugs
// (GET /internal/browser-gateway/power, browserPowerForRouter) and applies it
// (deployment/volition-stack/browser/project-browser-power.mjs).

const SETTING_KEY = 'browser-power';

export const DEFAULT_BROWSER_IDLE_MINUTES = 15;
export const MAX_BROWSER_IDLE_MINUTES = 24 * 60;

export interface BrowserPowerSettings {
  idleMinutes: number;
  alwaysOnProjectIds: number[];
  homeAlwaysOn: boolean;
}

export type BrowserPowerPatch = Partial<BrowserPowerSettings>;

function validMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_BROWSER_IDLE_MINUTES
  );
}

function projectIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter(
    (id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
  );
  return [...new Set(ids)].sort((a, b) => a - b);
}

export function sanitizeBrowserPower(value: unknown): BrowserPowerSettings {
  const stored = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    idleMinutes: validMinutes(stored.idleMinutes)
      ? stored.idleMinutes
      : DEFAULT_BROWSER_IDLE_MINUTES,
    alwaysOnProjectIds: projectIds(stored.alwaysOnProjectIds),
    homeAlwaysOn: stored.homeAlwaysOn === true,
  };
}

export async function getBrowserPowerSettings(): Promise<BrowserPowerSettings> {
  return sanitizeBrowserPower(await getSetting<unknown>(SETTING_KEY));
}

export async function setBrowserPowerSettings(
  patch: BrowserPowerPatch,
): Promise<BrowserPowerSettings> {
  if (patch.idleMinutes !== undefined && !validMinutes(patch.idleMinutes)) {
    throw new HttpError(
      400,
      `idleMinutes must be a whole number of minutes from 0 to ${MAX_BROWSER_IDLE_MINUTES}`,
    );
  }
  const current = await getBrowserPowerSettings();
  let alwaysOnProjectIds = current.alwaysOnProjectIds;
  if (patch.alwaysOnProjectIds !== undefined) {
    alwaysOnProjectIds = projectIds(patch.alwaysOnProjectIds);
    if (alwaysOnProjectIds.length !== patch.alwaysOnProjectIds.length) {
      throw new HttpError(400, 'alwaysOnProjectIds must be distinct project ids');
    }
    const known = new Set((await db.select({ id: project.id }).from(project)).map((row) => row.id));
    const unknown = alwaysOnProjectIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new HttpError(400, `Unknown project: ${unknown.join(', ')}`);
  }
  const next: BrowserPowerSettings = {
    idleMinutes: patch.idleMinutes ?? current.idleMinutes,
    alwaysOnProjectIds,
    homeAlwaysOn: patch.homeAlwaysOn ?? current.homeAlwaysOn,
  };
  await setSetting(SETTING_KEY, next);
  return next;
}

// What the router needs: the idle time and the slugs of the browsers kept running (the router
// knows a project browser only by its slug). A project deleted since it was marked is left out.
export function alwaysOnSlugs(
  settings: BrowserPowerSettings,
  projects: { id: number; key: string }[],
): string[] {
  const keys = new Map(projects.map((row) => [row.id, row.key]));
  const slugs = settings.alwaysOnProjectIds.flatMap((id) => {
    const key = keys.get(id);
    return key ? [projectSlug(key)] : [];
  });
  if (settings.homeAlwaysOn) slugs.push(HOME_SLUG);
  return [...new Set(slugs)].sort();
}

export async function browserPowerForRouter(): Promise<{
  schemaVersion: 1;
  idleMinutes: number;
  alwaysOn: string[];
}> {
  const settings = await getBrowserPowerSettings();
  const projects = await db.select({ id: project.id, key: project.key }).from(project);
  return {
    schemaVersion: 1,
    idleMinutes: settings.idleMinutes,
    alwaysOn: alwaysOnSlugs(settings, projects),
  };
}
