// Whether an embedded tool (code-server, a terminal, the browser's desktop, a preview)
// answers before its frame is shown (Auftrag 116): a frame on a dead address shows the
// browser's own "This page couldn't load", which Ava never shows. The probe asks the
// address itself; a frame of this origin is also checked after it loaded, because a page
// the browser refused to show (an error page) has no document Ava can read.

export type FrameProblemReason =
  // Nothing answered: the service is down, restarting, or the network changed.
  | 'unreachable'
  // It answered with an error (404, 502 …).
  | 'status'
  // Signed out or not allowed (401, 403).
  | 'forbidden'
  // No answer within the time limit.
  | 'timeout'
  // It loaded, but the browser showed its own error page instead (refused, blocked).
  | 'blocked';

export type FrameProbeResult =
  { ok: true } | { ok: false; reason: FrameProblemReason; status?: number };

export const FRAME_PROBE_TIMEOUT_MS = 8_000;
// How long a frame may take to load after its address answered.
export const FRAME_LOAD_TIMEOUT_MS = 20_000;
// While a frame is down, it is asked again: soon, then less often.
export const FRAME_RETRY_DELAYS_MS = [3_000, 5_000, 10_000, 20_000, 30_000];

export function frameRetryDelay(attempt: number): number {
  return FRAME_RETRY_DELAYS_MS[Math.min(Math.max(attempt, 0), FRAME_RETRY_DELAYS_MS.length - 1)]!;
}

export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url, origin).origin === origin;
  } catch {
    return false;
  }
}

// What a status code of the address means for its frame.
export function statusResult(status: number): FrameProbeResult {
  if (status === 401 || status === 403) return { ok: false, reason: 'forbidden', status };
  if (status >= 400) return { ok: false, reason: 'status', status };
  return { ok: true };
}

export async function probeFrameUrl(
  url: string,
  {
    origin,
    fetcher = fetch,
    timeoutMs = FRAME_PROBE_TIMEOUT_MS,
  }: { origin: string; fetcher?: typeof fetch; timeoutMs?: number },
): Promise<FrameProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const local = sameOrigin(url, origin);
  try {
    const response = await fetcher(url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      // A redirect (to a sign-in) is the frame's to follow; only whether it answers counts.
      redirect: 'manual',
      // Another origin answers opaquely: only "it answered" can be read.
      mode: local ? 'same-origin' : 'no-cors',
      signal: controller.signal,
    });
    if (response.type === 'opaque' || response.type === 'opaqueredirect') return { ok: true };
    return statusResult(response.status);
  } catch {
    return controller.signal.aborted
      ? { ok: false, reason: 'timeout' }
      : { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

// After a frame of this origin loaded: the browser's own error page is a document of
// another origin (chrome-error://), so it cannot be read. A frame of another origin can
// never be read and counts as loaded.
export function loadedFrameProblem(
  frame: Pick<HTMLIFrameElement, 'contentDocument'> | null,
  local: boolean,
): FrameProbeResult {
  if (!frame || !local) return { ok: true };
  try {
    const doc = frame.contentDocument;
    if (!doc) return { ok: false, reason: 'blocked' };
    const href = doc.location?.href ?? '';
    if (href.startsWith('chrome-error:')) return { ok: false, reason: 'blocked' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'blocked' };
  }
}
