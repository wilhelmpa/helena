import { serverRuntimeEnv } from '@/utils/runtimeEnv';

// Copied from the api's response, including the headers that keep the bytes inert
// (nosniff, the disposition, the sandbox policy) and the ones a seeking video needs.
const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-disposition',
  'cache-control',
  'etag',
  'x-content-type-options',
  'content-security-policy',
  'accept-ranges',
  'content-range',
];

const FORWARDED_REQUEST_HEADERS = ['if-none-match', 'range'];

// Streams one file from a fixed api route with the reader's session. The caller builds
// `upstreamPath` from validated parts only: this route forwards the cookie, so an
// arbitrary path would make it an authenticated proxy to the whole api.
export async function forwardFile(request: Request, upstreamPath: string): Promise<Response> {
  const cookie = request.headers.get('cookie');
  if (!cookie) return new Response(null, { status: 401 });

  const headers: Record<string, string> = { cookie };
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  const origin = process.env.SERVICE_URL_API || serverRuntimeEnv().apiUrl;
  const upstream = await fetch(`${origin}${upstreamPath}`, {
    headers,
    cache: 'no-store',
    redirect: 'error',
  });

  const passed = new Headers();
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) passed.set(name, value);
  }
  passed.set('Cache-Control', 'private, no-store');
  passed.set('Vary', 'Cookie');
  return new Response(upstream.body, { status: upstream.status, headers: passed });
}

const MAX_PATH_LENGTH = 1024;

// The query a file route accepts: one of the known roots, a path, and the download
// switch. Anything else is dropped rather than passed on.
export function fileQuery(request: Request, roots: readonly string[]): string | null {
  const params = new URL(request.url).searchParams;
  const root = params.get('root') ?? '';
  const path = params.get('path') ?? '';
  if (!roots.includes(root) || !path || path.length > MAX_PATH_LENGTH) return null;
  const query = new URLSearchParams({ root, path });
  if (params.has('download')) query.set('download', '1');
  return query.toString();
}

// The query of a vault file route: one path, nothing else.
export function vaultPathQuery(request: Request): string | null {
  const path = new URL(request.url).searchParams.get('path') ?? '';
  const hasControlCharacter = [...path].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (!path || path.length > MAX_PATH_LENGTH || hasControlCharacter) return null;
  return new URLSearchParams({ path }).toString();
}
