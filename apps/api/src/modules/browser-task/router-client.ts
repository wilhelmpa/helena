import { lstat, readFile } from 'node:fs/promises';
import { HttpError } from '#shared/lib';

// Browser 2.0 asks the browser router (the process that holds the project browsers and runs the
// gateway, deployment/volition-stack/browser) to start a test run: over loopback, with the
// gateway's own service token (BROWSER_GATEWAY_TOKEN_FILE, which this API already checks the
// gateway's calls against). The router refuses the route from anywhere but loopback.

function routerUrl(): string {
  const port = Number(process.env.PROJECT_BROWSER_ROUTER_PORT || 6082);
  return process.env.HELENA_BROWSER_ROUTER_URL?.trim() || `http://127.0.0.1:${port}`;
}

function secretModeMask(file: string): number {
  const dir = process.env.CREDENTIALS_DIRECTORY;
  return dir && file.startsWith(`${dir}/`) ? 0o037 : 0o077;
}

async function gatewayToken(): Promise<string> {
  const file = process.env.BROWSER_GATEWAY_TOKEN_FILE?.trim();
  if (!file) throw new HttpError(503, 'The browser gateway is not set up on this server.');
  const stat = await lstat(file).catch(() => null);
  if (
    !stat ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & secretModeMask(file)) !== 0
  ) {
    throw new HttpError(503, 'The browser gateway token is not readable.');
  }
  return (await readFile(file, 'utf8')).trim();
}

export async function postToRouter(path: string, body: unknown): Promise<unknown> {
  const token = await gatewayToken();
  let res: Response;
  try {
    res = await fetch(`${routerUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(503, 'The browser router does not answer.');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new HttpError(
      res.status >= 500 ? 502 : res.status,
      `The browser router refused the request (HTTP ${res.status}).`,
    );
  }
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    throw new HttpError(502, 'The browser router returned an invalid response.');
  }
}
