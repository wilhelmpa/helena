import type { UpdateFetchOptions } from '@helena/sdk';

// The update center reads the vendors' published data: registries, release feeds, the
// Debian changelogs. Every read goes through here and reaches only the hosts the update
// source declared (docs/helena-decisions/update-center.md §2): a redirect to any other
// host is refused, a read stops after FETCH_TIMEOUT_MS and after `maxBytes`. Nothing is
// sent but the request itself; no credential is ever attached.

const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

export class UpdateFetchError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'UpdateFetchError';
  }
}

// The test suite never reaches the internet: it installs a fake with setUpdateFetch.
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, init);

export function setUpdateFetch(next: Fetcher | null): void {
  fetcher = next ?? ((url, init) => fetch(url, init));
}

function allowed(url: URL, hosts: readonly string[]): boolean {
  return url.protocol === 'https:' && hosts.includes(url.hostname.toLowerCase());
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - size;
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
    size += Math.min(value.byteLength, room);
    if (size >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// GETs (or POSTs) `url` and answers its body as text. Throws UpdateFetchError for a host
// that is not allowed, a failed status and a timeout.
export async function fetchVendorText(
  url: string,
  hosts: readonly string[],
  options: UpdateFetchOptions = {},
  signal?: AbortSignal,
): Promise<string> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new UpdateFetchError(`Not a URL: ${url}`);
  }
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowed(target, hosts)) throw new UpdateFetchError(`${target.host} is not allowed here`);
    let response: Response;
    try {
      response = await fetcher(target.toString(), {
        method: options.method ?? 'GET',
        body: options.body,
        headers: { 'User-Agent': 'helena-update-center', ...options.headers },
        redirect: 'manual',
        signal: combined,
      });
    } catch (error) {
      throw new UpdateFetchError(
        `${target.host}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location) throw new UpdateFetchError(`${target.host} redirected nowhere`);
      target = new URL(location, target);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new UpdateFetchError(`${target.host} answered ${response.status}`, response.status);
    }
    return readBounded(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
  }
  throw new UpdateFetchError(`${url} redirected too often`);
}

export async function fetchVendorJson<T>(
  url: string,
  hosts: readonly string[],
  options: UpdateFetchOptions = {},
  signal?: AbortSignal,
): Promise<T> {
  const text = await fetchVendorText(
    url,
    hosts,
    { ...options, headers: { Accept: 'application/json', ...options.headers } },
    signal,
  );
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpdateFetchError(`${new URL(url).host} did not answer JSON`);
  }
}
