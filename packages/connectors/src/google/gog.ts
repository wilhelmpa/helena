import { spawn } from 'node:child_process';

// The optional gog engine: Google accounts whose tokens live in the keyring of the gog CLI
// (github.com/steipete/gogcli), under its own Unix user. Helena never runs gog itself. It
// sends one JSON request to the broker (deployment/volition-stack/native/google/
// helena-google-broker, run through sudo as that user), which checks the request against
// its allowlist, runs gog and answers with one JSON object. The broker never exports a
// token; the keyring stays where it is.

export type GogRequest =
  | { op: 'accounts' }
  | { op: 'auth-start'; email: string; services: string[] }
  | { op: 'auth-finish'; email: string; services: string[]; redirectUrl: string }
  | { op: 'credentials'; json: string }
  | { op: 'remove'; email: string }
  | { op: 'run'; email: string; command: string; args: string[]; stdin?: string };

export interface GogBroker {
  call(request: GogRequest): Promise<unknown>;
}

export class GogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GogError';
  }
}

const TIMEOUT_MS = 90_000;
const MAX_OUTPUT = 8 * 1024 * 1024;

// The broker as a command line, e.g. `sudo -n -u volition-google
// /usr/local/libexec/helena-google-broker`. It is split on spaces and run without a shell.
export function gogBroker(commandLine: string, timeoutMs = TIMEOUT_MS): GogBroker {
  const [command, ...args] = commandLine.trim().split(/\s+/);
  if (!command) throw new GogError('No gog broker is configured.');
  return {
    call(request) {
      return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' },
        });
        const out: Buffer[] = [];
        let size = 0;
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new GogError('gog did not answer in time.'));
        }, timeoutMs);
        child.stdout.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_OUTPUT) {
            child.kill('SIGKILL');
            return;
          }
          out.push(chunk);
        });
        // The broker's diagnostics stay on the server; they are never shown or logged
        // here, since gog may print account details there.
        child.stderr.resume();
        child.on('error', () => {
          clearTimeout(timer);
          reject(new GogError('The gog broker could not be started.'));
        });
        child.on('close', () => {
          clearTimeout(timer);
          let answer: { ok?: boolean; result?: unknown; error?: unknown };
          try {
            answer = JSON.parse(Buffer.concat(out).toString('utf8'));
          } catch {
            reject(new GogError('The gog broker gave no answer.'));
            return;
          }
          if (answer.ok) resolve(answer.result ?? null);
          else {
            reject(
              new GogError(
                typeof answer.error === 'string' ? answer.error.slice(0, 500) : 'gog failed.',
              ),
            );
          }
        });
        child.stdin.end(JSON.stringify(request));
      });
    },
  };
}

export interface GogAccount {
  email: string;
  services: string[];
  ok: boolean;
  error: string | null;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean);
  return [];
}

// gog's `auth list --check --json` output as accounts. Read tolerantly: the output is an
// array or an object holding one, each entry naming the account under `email` or `account`.
export function gogAccounts(output: unknown): GogAccount[] {
  const list = Array.isArray(output)
    ? output
    : output && typeof output === 'object'
      ? (Object.values(output).find(Array.isArray) ?? [])
      : [];
  const accounts: GogAccount[] = [];
  for (const entry of list as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const email = [row.email, row.account, row.Email].find(
      (value): value is string => typeof value === 'string' && value.includes('@'),
    );
    if (!email) continue;
    const error = [row.error, row.check_error, row.checkError].find(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    const valid = [row.ok, row.valid, row.check].find((value) => typeof value === 'boolean');
    accounts.push({
      email: email.toLowerCase(),
      services: stringList(row.services),
      ok: error ? false : valid !== false,
      error: error ? error.slice(0, 300) : null,
    });
  }
  return accounts;
}
