import type { ManagedPreview } from './helena-client.ts';

export type NavigationState =
  | {
      type: 'preview-unreachable';
      url: string;
      name: string;
      reason: 'stopped' | 'starting' | 'error';
      logs: string[];
      error?: string;
      nextStep: string;
    }
  | { type: 'navigation-error'; url: string; code: string; message: string };
export type PreviewState = Extract<NavigationState, { type: 'preview-unreachable' }>;
export type NavigationErrorState = Extract<NavigationState, { type: 'navigation-error' }>;

const READY_WAIT_MS = 6_000;

export function matchingPreview(
  url: string,
  entries: ManagedPreview[],
): ManagedPreview | undefined {
  const matches = entries.filter((entry) => {
    try {
      return new URL(entry.url).origin === new URL(url).origin;
    } catch {
      return false;
    }
  });
  return matches.sort(
    (a, b) =>
      (a.status === 'running' ? 0 : a.status === 'starting' ? 1 : 2) -
      (b.status === 'running' ? 0 : b.status === 'starting' ? 1 : 2),
  )[0];
}

export function previewFailure(preview: ManagedPreview, url: string): PreviewState {
  return {
    type: 'preview-unreachable',
    url,
    name: preview.name,
    reason:
      preview.status === 'stopped'
        ? 'stopped'
        : preview.status === 'starting'
          ? 'starting'
          : 'error',
    logs: preview.lines.slice(-20),
    ...(preview.error && { error: preview.error }),
    nextStep:
      preview.status === 'starting'
        ? 'Check preview_status for readiness, then retry browser_navigate.'
        : preview.status === 'stopped'
          ? 'Start the preview with preview_start, then use the returned URL.'
          : 'Check preview_status and preview_logs; fix the reported failure before retrying.',
  };
}

export function previewFailureMessage(state: PreviewState, detail?: string): string {
  const logs = state.logs.slice(-5).map((line) => line.slice(0, 500));
  return [
    `Preview ${state.name} is ${state.reason}${detail ? ` (${detail})` : ''}.`,
    ...(state.error ? [`Status error: ${state.error}`] : []),
    ...(logs.length ? [`Recent logs:\n${logs.join('\n')}`] : []),
    state.nextStep,
  ].join('\n');
}

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
  let lastPreview: ManagedPreview | null = null;
  while (true) {
    const entries = await previews();
    const preview = matchingPreview(url, entries);
    if (!preview) {
      if (!lastPreview) return { managed: false, state: null };
      return {
        managed: true,
        state: previewFailure(
          { ...lastPreview, status: 'stopped' },
          `${parsed.origin}${parsed.pathname}`,
        ),
      };
    }
    lastPreview = preview;
    if (preview.status === 'running') return { managed: true, state: null };
    if (preview.status === 'stopped' || preview.status === 'failed' || Date.now() >= deadline) {
      return {
        managed: true,
        state: previewFailure(preview, `${parsed.origin}${parsed.pathname}`),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
  }
}
