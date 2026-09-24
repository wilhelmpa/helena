// How Claude Code and Codex are signed in when Helena runs them (docs/helena-decisions/
// cli-runtimes.md). Nobody logs in through Helena: the owner creates the login with the
// runtime's own tool and either stores it in Zugänge as a "Laufzeit-Anmeldung", which
// Helena gives to the agents it is granted to, or signs the agent's own runtime home in
// (Codex' device login). The runner then
//
//   - reads a granted login from Helena before each run and chat answer and hands it to
//     that one command in its environment, never on its command line or on disk
//     (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`, ANTHROPIC_API_KEY, CODEX_API_KEY);
//   - otherwise leaves the runtime its own login in the agent's home;
//   - reads the runtime's answer for a refused login, which Helena shows as "Laufzeit
//     nicht angemeldet" until a command gets through again.

export type CliLoginRuntime = 'claude' | 'codex';
export type CliLoginMethod = 'oauth_token' | 'api_key';

// A login as Helena hands it to the runner for one run or chat answer.
export interface CliLogin {
  credentialId: number;
  runtime: CliLoginRuntime;
  method: CliLoginMethod;
  value: string;
}

// What Helena says about the agent's login without handing it out: whether one is granted
// and how it signs in.
export interface CliLoginState {
  credentialId: number;
  runtime: CliLoginRuntime;
  method: CliLoginMethod;
}

// The variable each runtime reads a login of each kind from. Codex takes no OAuth token
// from its environment: its ChatGPT login lives in the agent's home (auth.json).
const LOGIN_VARIABLES: Record<CliLoginRuntime, Partial<Record<CliLoginMethod, string>>> = {
  claude: { oauth_token: 'CLAUDE_CODE_OAUTH_TOKEN', api_key: 'ANTHROPIC_API_KEY' },
  codex: { api_key: 'CODEX_API_KEY' },
};

// Every variable a runtime could take a login from. The runner clears the ones it does
// not set, so no login of the runner's own environment reaches an agent by accident.
export const LOGIN_ENV_NAMES = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
] as const;

export function loginVariable(runtime: CliLoginRuntime, method: CliLoginMethod): string | null {
  return LOGIN_VARIABLES[runtime][method] ?? null;
}

// The environment one command gets for its login: the granted one set. For an agent
// Helena provisioned (`isolate`), every other login variable is emptied, so a login of the
// runner's own environment never reaches it; an operator's own runner keeps its shell's.
export function loginEnv(
  runtime: CliLoginRuntime,
  login: CliLogin | null,
  isolate: boolean,
): Record<string, string> {
  const env: Record<string, string> = isolate
    ? Object.fromEntries(LOGIN_ENV_NAMES.map((name) => [name, '']))
    : {};
  if (!login || login.runtime !== runtime) return env;
  const variable = loginVariable(runtime, login.method);
  if (variable && login.value) env[variable] = login.value;
  return env;
}

// Reads a command's output for a login the runtime's service refused: Claude Code marks
// the message `"error":"authentication_failed"`, Codex reports a 401 from the model API.
// A long run is not kept in memory for it: only each line is looked at.
export class LoginRefusalReader {
  private line = '';
  private refusedSeen = false;
  private answered = false;

  constructor(private readonly runtime: CliLoginRuntime) {}

  write(chunk: string): void {
    const lines = (this.line + chunk).split('\n');
    this.line = (lines.pop() ?? '').slice(-65_536);
    for (const line of lines) this.read(line);
  }

  end(): void {
    this.read(this.line);
    this.line = '';
  }

  // True when the service refused the login and the command never got an answer from the
  // model: a single 401 the command recovered from does not count.
  refused(): boolean {
    return this.refusedSeen && !this.answered;
  }

  private read(line: string): void {
    if (!line.trim()) return;
    if (this.runtime === 'claude') {
      if (
        line.includes('"authentication_failed"') ||
        line.includes('"error":"oauth_org_not_allowed"')
      ) {
        this.refusedSeen = true;
        return;
      }
      if (line.includes('"type":"assistant"') && !line.includes('"is_api_error_message":true')) {
        this.answered = true;
      }
      return;
    }
    if (/\b401 Unauthorized\b|"refresh_token_reused"|token_expired|Not logged in/.test(line)) {
      this.refusedSeen = true;
      return;
    }
    if (line.includes('"type":"item.completed"') && line.includes('"agent_message"')) {
      this.answered = true;
    }
  }
}
