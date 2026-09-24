// The project browser's toolbar routes, served by the browser router next to the views
// the browser tool shows (`/browser/projects/<slug>/api/...`), on the same origin.

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  // The tab in front: the one most recently used.
  active: boolean;
}

export type BrowserAction =
  'navigate' | 'back' | 'forward' | 'reload' | 'activate' | 'close' | 'new';

// A bookmark of the project's browser (the browser bar's star menu), kept by the router.
export interface BrowserBookmark {
  url: string;
  title: string;
}

export function browserBookmarksQueryKey(base: string) {
  return ['browser-bookmarks', base] as const;
}

export function browserTabsQueryKey(base: string) {
  return ['browser-tabs', base] as const;
}

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

// The control lock's Übernehmen/Zurückgeben actions (design §5): same base as the other
// toolbar routes, same fetch convention as browserAction, no body. The router side of
// these two routes is being built in parallel (see useBrowserLock.ts), so a call here can
// answer 404 until it lands — browserLock* surfaces that as a normal thrown Error, same as
// any other browserAction failure, for the caller to show as a toast.
export async function browserLockTakeover(base: string): Promise<void> {
  await answer(
    await fetch(`${base}/lock-takeover`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
    }),
  );
}

export async function browserLockRelease(base: string): Promise<void> {
  await answer(
    await fetch(`${base}/lock-release`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
    }),
  );
}

export async function browserBookmarks(base: string): Promise<BrowserBookmark[]> {
  const body = await answer<{ bookmarks: BrowserBookmark[] }>(
    await fetch(`${base}/bookmarks`, { credentials: 'same-origin', cache: 'no-store' }),
  );
  return body.bookmarks;
}

export async function saveBrowserBookmarks(
  base: string,
  bookmarks: BrowserBookmark[],
): Promise<BrowserBookmark[]> {
  const body = await answer<{ bookmarks: BrowserBookmark[] }>(
    await fetch(`${base}/bookmarks`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookmarks }),
    }),
  );
  return body.bookmarks;
}
