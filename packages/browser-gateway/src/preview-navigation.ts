import type { ManagedPreview } from './helena-client.ts';

export type NavigationState =
  | {
      type: 'preview-unreachable';
      url: string;
      name: string;
      reason: 'stopped' | 'starting' | 'error';
      logs: string[];
      error?: string;
    }
  | { type: 'navigation-error'; url: string; code: string; message: string };
export type PreviewState = Extract<NavigationState, { type: 'preview-unreachable' }>;
export type NavigationErrorState = Extract<NavigationState, { type: 'navigation-error' }>;

const READY_WAIT_MS = 6_000;

export function navigationError(url: string, failure: unknown): NavigationErrorState | null {
  const message = failure instanceof Error ? failure.message : String(failure);
  const code =
    /net::(ERR_[A-Z_]+)/.exec(message)?.[1] ??
    (message.includes('chrome-error://') ? 'CHROME_ERROR_PAGE' : null);
  let label = '';
  try {
    const parsed = new URL(url);
    label = `${parsed.origin}${parsed.pathname}`.slice(0, 300);
  } catch {
    /* A click may navigate without an explicit URL. */
  }
  return code
    ? { type: 'navigation-error', url: label, code, message: `Navigation failed: ${code}` }
    : null;
}

export async function checkPreviewNavigation(
  url: string,
  previews: () => Promise<ManagedPreview[]>,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  waitMs = READY_WAIT_MS,
): Promise<{ managed: boolean; state: PreviewState | null }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { managed: false, state: null };
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1')
    return { managed: false, state: null };
  const deadline = Date.now() + waitMs;
  let managed = false;
  let lastPreview: ManagedPreview | null = null;
  while (true) {
    const entries = await previews();
    const preview = entries.find((entry) => {
      try {
        return new URL(entry.url).origin === parsed.origin;
      } catch {
        return false;
      }
    });
    if (!preview) {
      if (!lastPreview) return { managed: false, state: null };
      return {
        managed: true,
        state: {
          type: 'preview-unreachable',
          url: `${parsed.origin}${parsed.pathname}`,
          name: lastPreview.name,
          reason: 'stopped',
          logs: lastPreview.lines.slice(-20),
        },
      };
    }
    managed = true;
    lastPreview = preview;
    if (preview.status === 'running') {
      try {
        await fetchImpl(parsed.origin, {
          method: 'HEAD',
          redirect: 'manual',
          signal: AbortSignal.timeout(800),
        });
        return { managed, state: null };
      } catch {
        /* The service may still be binding its port. */
      }
    }
    if (preview.status === 'stopped' || preview.status === 'failed' || Date.now() >= deadline) {
      return {
        managed,
        state: {
          type: 'preview-unreachable',
          url: `${parsed.origin}${parsed.pathname}`,
          name: preview.name,
          reason:
            preview.status === 'stopped'
              ? 'stopped'
              : preview.status === 'starting'
                ? 'starting'
                : 'error',
          logs: preview.lines.slice(-20),
          ...(preview.error && { error: preview.error }),
        },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
  }
}
