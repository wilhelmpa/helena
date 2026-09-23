// The project browser's toolbar routes, served by the browser router next to the stream
// the browser tool shows (`/browser/projects/<slug>/api/...`), on the same origin.

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  // The tab in front: the one most recently used.
  active: boolean;
}

export type BrowserAction = 'navigate' | 'back' | 'forward' | 'reload' | 'activate' | 'close' | 'new';

// The control routes of the browser a stream URL shows, or null for a URL that is not a
// project browser stream.
export function browserControlBase(streamUrl: string): string | null {
  const match = /^(https?:\/\/[^/]+\/browser\/projects\/[a-z0-9][a-z0-9-]*)\//.exec(streamUrl);
  return match ? `${match[1]}/api` : null;
}

async function answer<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error ?? `The browser answered ${response.status}`);
  return body as T;
}

export async function browserTabs(base: string): Promise<BrowserTab[]> {
  const body = await answer<{ tabs: BrowserTab[] }>(
    await fetch(`${base}/tabs`, { credentials: 'same-origin', cache: 'no-store' }),
  );
  return body.tabs;
}

export async function browserAction(
  base: string,
  action: BrowserAction,
  body: { id?: string; url?: string },
): Promise<void> {
  await answer(
    await fetch(`${base}/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}
