import type { LiveControlState, LiveHandover } from './browserLive';

// Home's "Browser" overview reads the live state of every project browser from the browser
// router, which serves it next to the live views (`/browser/api/overview`, same origin and
// the same login as the live views; deployment/volition-stack/browser/project-browser-overview.mjs).
export const BROWSER_ROUTER_BASE = '/browser';
export const HOME_BROWSER_SLUG = 'home';

// The slug a project's browser goes by (the deployment's projectSlug: the key in lower case,
// VERV's browser is "verve").
export function browserSlug(projectKey: string): string {
  return projectKey === 'VERV' ? 'verve' : projectKey.toLowerCase();
}

// Whether a project browser runs: project browsers run on demand, the router starts one when
// it is used and stops it after the idle time. "unknown" until the router has looked.
export type BrowserPower = 'running' | 'starting' | 'stopping' | 'stopped' | 'unknown';

export interface RouterBrowserState {
  slug: string;
  // Missing from a router without project browsers on demand: then it runs.
  power?: BrowserPower;
  reachable: boolean;
  url: string | null;
  title: string | null;
  tabCount: number;
  control: LiveControlState;
  handover: LiveHandover | null;
}

export async function browserRouterOverview(): Promise<RouterBrowserState[]> {
  const response = await fetch(`${BROWSER_ROUTER_BASE}/api/overview`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`The browser router answered ${response.status}`);
  const body = (await response.json()) as { browsers?: RouterBrowserState[] };
  return body.browsers ?? [];
}

// A small picture of the tab in front; `version` changes when the overview is read again,
// so the picture follows it.
export function browserThumbnailUrl(slug: string, version: number): string {
  return `${BROWSER_ROUTER_BASE}/projects/${encodeURIComponent(slug)}/api/thumbnail?v=${version}`;
}
