import { cache } from 'react';

const DEFAULT_DISPLAY_NAME = 'Ava';

// Read on the server for every page, so it goes to the API directly: API_URL is the public
// address behind the edge's sign-in (Cloudflare Access), which answers a server-side request
// with its login page. A missing or unreachable name falls back to the default rather than
// failing the page (2026-09-30: every page answered 500 behind the edge).
export const getDisplayName = cache(async (): Promise<string> => {
  const api = (process.env.SERVICE_URL_API || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  try {
    const response = await fetch(`${api}/display-name`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return DEFAULT_DISPLAY_NAME;
    const data = (await response.json()) as { displayName?: unknown };
    return typeof data.displayName === 'string' && data.displayName.trim()
      ? data.displayName
      : DEFAULT_DISPLAY_NAME;
  } catch {
    return DEFAULT_DISPLAY_NAME;
  }
});
