import { serverRuntimeEnv } from '@/utils/runtimeEnv';

// A vault file (an image in a note) loaded by the browser. This route has one fixed
// upstream: unlike the public /media proxy it forwards the session cookie, so accepting
// an arbitrary upstream path would turn the web application into an authenticated API
// proxy. The API checks the path against the session's reach in the vault.
const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-disposition',
  'cache-control',
  'etag',
  'x-content-type-options',
  'content-security-policy',
];

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get('path') ?? '';
  if (!validVaultPath(path)) return new Response(null, { status: 404 });

  const cookie = request.headers.get('cookie');
  if (!cookie) return new Response(null, { status: 401 });

  const origin = process.env.SERVICE_URL_API || serverRuntimeEnv().apiUrl;
  const upstream = await fetch(`${origin}/knowledge/raw?${new URLSearchParams({ path })}`, {
    headers: forwardedHeaders(request, cookie),
    cache: 'no-store',
    redirect: 'error',
  });

  const headers = new Headers();
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

function validVaultPath(value: string): boolean {
  const hasControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  return value.length > 0 && value.length <= 1024 && !hasControlCharacter;
}

function forwardedHeaders(request: Request, cookie: string): HeadersInit {
  const headers: Record<string, string> = { cookie };
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
  return headers;
}
