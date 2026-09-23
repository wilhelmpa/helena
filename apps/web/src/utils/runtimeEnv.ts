// The per-instance origins the browser needs. A NEXT_PUBLIC_* value is inlined into
// the bundle by `next build`, which pins one build to one instance; these are read
// from the server process on every render and handed to the browser by
// RuntimeEnvScript, so the same build serves any instance.

export interface RuntimeEnv {
  apiUrl: string;
  privacyUrl: string;
  termsUrl: string;
  logoutUrl?: string;
  workspace: WorkspaceRuntimeEnv;
}

export interface WorkspaceRuntimeEnv {
  homeChatProjectKey: string;
  terminalUrl: string;
  codeUrl: string;
  projectWorkspacePaths: Record<string, string>;
  browserUrl: string;
  inboxUrl: string;
  connectionsUrl: string;
  // The name the owner's Obsidian knows the vault by, for obsidian:// links.
  obsidianVault: string;
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
  obsidianVault: 'Volition',
});

export function serverRuntimeEnv(): RuntimeEnv {
  return {
    apiUrl: readOrigin('API_URL'),
    privacyUrl: readOrigin('PRIVACY_URL'),
    termsUrl: readOrigin('TERMS_URL'),
    logoutUrl: readOrigin('SSO_LOGOUT_URL'),
    workspace: {
      homeChatProjectKey: readOrigin('HOME_CHAT_PROJECT_KEY'),
      terminalUrl: readOrigin('TERMINAL_URL'),
      codeUrl: readOrigin('CODE_URL'),
      projectWorkspacePaths: readJsonRecord('PROJECT_WORKSPACE_PATHS'),
      browserUrl: readOrigin('BROWSER_URL'),
      inboxUrl: readOrigin('INBOX_URL'),
      connectionsUrl: readOrigin('CONNECTIONS_URL'),
      obsidianVault: readOrigin('OBSIDIAN_VAULT_NAME') || 'Volition',
    },
  };
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
