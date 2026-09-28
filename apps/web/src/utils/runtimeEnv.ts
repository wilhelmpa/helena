import { parseOrigins, rebaseUrl } from './appOrigins';

// The per-instance origins the browser needs. A NEXT_PUBLIC_* value is inlined into
// the bundle by `next build`, which pins one build to one instance; these are read
// from the server process on every render and handed to the browser by
// RuntimeEnvScript, so the same build serves any instance.
//
// An instance may answer on more than one origin (APP_URL: the public name through the
// tunnel, the home network's own name on the LAN; utils/appOrigins.ts). The addresses on
// one of them (the API, the tools) are handed out on the origin the page was opened on.

export interface RuntimeEnv {
  apiUrl: string;
  privacyUrl: string;
  termsUrl: string;
  // Not moved to the page's origin: signing out on the public name also ends the edge
  // provider's session there (Cloudflare Access), and UserMenu follows it only on its origin.
  logoutUrl?: string;
  // Every origin of the instance, the primary one first.
  appOrigins?: string[];
  // The home network's own origin (HELENA_HOME_URL): the app on another origin switches to
  // it at home (features/home-access).
  homeUrl?: string;
  // The name passkeys are bound to (PASSKEY_RP_ID); another origin cannot use them.
  passkeyRpId?: string;
  workspace: WorkspaceRuntimeEnv;
}

export interface WorkspaceRuntimeEnv {
  homeChatProjectKey: string;
  terminalUrl: string;
  codeUrl: string;
  projectWorkspacePaths: Record<string, string>;
  // The folder code-server opens on Home (Start), where no project names one: the
  // workspaces of Home and every project. Without it code-server reopened the folder that
  // was open last, another project's (2026-09-24: Start showed PRIV).
  homeWorkspacePath?: string;
  browserUrl: string;
  inboxUrl: string;
  connectionsUrl: string;
}

declare global {
  interface Window {
    __ITSAPLAN_ENV__?: RuntimeEnv;
  }
}

// The NEXT_PUBLIC_ prefixed name is still accepted, for a deployment that sets it on
// the container. Both names are read through a computed key: Next inlines a literal
// `process.env.NEXT_PUBLIC_X` at build time, server code included, and only a dynamic
// lookup reaches the running process.
function readOrigin(name: string): string {
  return process.env[name] || process.env[`NEXT_PUBLIC_${name}`] || '';
}

function readJsonRecord(name: string): Record<string, string> {
  const value = readOrigin(name);
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[0].trim() !== '' && entry[1].trim() !== '',
      ),
    );
  } catch {
    return {};
  }
}

const emptyWorkspace = (): WorkspaceRuntimeEnv => ({
  homeChatProjectKey: '',
  terminalUrl: '',
  codeUrl: '',
  projectWorkspacePaths: {},
  browserUrl: '',
  inboxUrl: '',
  connectionsUrl: '',
});

export function appOrigins(): string[] {
  return parseOrigins(readOrigin('APP_URL'));
}

function homeUrl(origins: string[]): string {
  const [home] = parseOrigins(readOrigin('HELENA_HOME_URL'));
  return home && origins.includes(home) ? home : '';
}

// `origin`: the origin the page is served on (utils/appOrigins requestOrigin); the API and
// tool addresses on another origin of the instance are moved to it. Without one (a caller
// outside a request) they stay as configured.
export function serverRuntimeEnv(origin: string | null = null): RuntimeEnv {
  const origins = appOrigins();
  const here = origin && origins.includes(origin) ? origin : null;
  const url = (name: string) => rebaseUrl(readOrigin(name), origins, here);
  return {
    apiUrl: url('API_URL'),
    privacyUrl: readOrigin('PRIVACY_URL'),
    termsUrl: readOrigin('TERMS_URL'),
    logoutUrl: readOrigin('SSO_LOGOUT_URL'),
    appOrigins: origins,
    homeUrl: homeUrl(origins),
    passkeyRpId: readOrigin('PASSKEY_RP_ID'),
    workspace: {
      homeChatProjectKey: readOrigin('HOME_CHAT_PROJECT_KEY'),
      terminalUrl: url('TERMINAL_URL'),
      codeUrl: url('CODE_URL'),
      projectWorkspacePaths: readJsonRecord('PROJECT_WORKSPACE_PATHS'),
      // The native install's layout unless the deployment names another.
      homeWorkspacePath:
        readOrigin('HOME_WORKSPACE_PATH') ||
        (readOrigin('CODE_URL') ? '/srv/volition/workspaces' : ''),
      browserUrl: url('BROWSER_URL'),
      inboxUrl: url('INBOX_URL'),
      connectionsUrl: url('CONNECTIONS_URL'),
    },
  };
}

// An address a response of the API or the provisioner named on another origin of the
// instance, moved to the origin this page runs on (the browser only).
export function onThisOrigin(value: string): string {
  if (typeof window === 'undefined') return value;
  return rebaseUrl(value, runtimeEnv().appOrigins ?? [], window.location.origin);
}

export function runtimeEnv(): RuntimeEnv {
  if (typeof window === 'undefined') return serverRuntimeEnv();
  return (
    window.__ITSAPLAN_ENV__ ?? {
      apiUrl: '',
      privacyUrl: '',
      termsUrl: '',
      workspace: emptyWorkspace(),
    }
  );
}
