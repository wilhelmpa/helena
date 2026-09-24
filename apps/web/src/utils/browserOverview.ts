import type { LiveControlState, LiveHandover } from './browserLive';

// Home's "Browser" overview reads the live state of every project browser from the browser
// router, which serves it next to the live views (`/browser/api/overview`, same origin and
// the same login as the live views; deployment/volition-stack/browser/project-browser-overview.mjs).
export const BROWSER_ROUTER_BASE = '/browser';
export const HOME_BROWSER_SLUG = 'home';

export interface RouterBrowserState {
  slug: string;
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
