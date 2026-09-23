// A thin client for Plan's internal browser-gateway routes
// (apps/api/src/modules/agent-browser-gateway/internal.ts). Every call carries the
// gateway's own service token (design §3: "Service-Token und Agent-Key") plus whichever
// agent it is acting for, and never assumes more than that response tells it — Plan is the
// one place that checks grants, project membership and scope.

export interface BrowserGatewaySettingsWire {
  domainBlocklist: string[];
  domainAllowlist: string[];
  humanInput: boolean;
  lockTimeoutSec: number;
}

export interface ResolveResult {
  agentId: number;
  agentName: string;
  teamId: number;
  projectId: number;
  browserGatewayEnabled: boolean;
  settings: BrowserGatewaySettingsWire;
}

export type LoginResult =
  | {
      status: 'filled';
      login: { id: number; label: string; username: string; password: string; has2fa: boolean };
    }
  | { status: 'choose'; candidates: { id: number; label: string; username: string }[] }
  | { status: 'none' };

export interface LoginCodeResult {
  code: string;
  secondsRemaining: number;
}

export class PlanApiError extends Error {
  // Not a TypeScript parameter property (public status: number in the constructor
  // signature): the deployment glue that uses this package runs under plain Node's
  // TypeScript type-stripping (erasable syntax only — no parameter properties, which need
  // real code generation, not just erasure), so every field here is declared and assigned
  // the ordinary way.
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface PlanClientOptions {
  baseUrl: string; // e.g. http://127.0.0.1:3000
  serviceToken: string;
  fetchImpl?: typeof fetch;
}

export class PlanClient {
  #baseUrl: string;
  #token: string;
  #fetch: typeof fetch;

  constructor(options: PlanClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#token = options.serviceToken;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async #post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.#fetch(`${this.#baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#token}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        // not JSON, use as-is
      }
      throw new PlanApiError(res.status, message);
    }
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  resolve(agentKey: string, projectSlug: string): Promise<ResolveResult> {
    return this.#post('/internal/browser-gateway/resolve', { agentKey, projectSlug });
  }

  login(
    agentKey: string,
    projectSlug: string,
    frameOrigin: string,
    credentialId?: number,
    work?: { runId?: number; messageId?: number },
  ): Promise<LoginResult> {
    return this.#post('/internal/browser-gateway/login', {
      agentKey,
      projectSlug,
      frameOrigin,
      credentialId,
      ...work,
    });
  }

  loginCode(
    agentKey: string,
    credentialId: number,
    work?: { runId?: number; messageId?: number },
  ): Promise<LoginCodeResult> {
    return this.#post('/internal/browser-gateway/login-code', { agentKey, credentialId, ...work });
  }

  audit(input: {
    agentKey: string;
    projectSlug: string;
    actor: 'agent' | 'owner';
    tool: string;
    target?: string;
  }): Promise<void> {
    return this.#post('/internal/browser-gateway/audit', input);
  }

  async policy(): Promise<Record<string, BrowserGatewaySettingsWire & { projectId: number }>> {
    const res = await this.#fetch(`${this.#baseUrl}/internal/browser-gateway/policy`, {
      headers: { authorization: `Bearer ${this.#token}` },
    });
    if (!res.ok) throw new PlanApiError(res.status, await res.text());
    const body = (await res.json()) as {
      projects: Record<string, BrowserGatewaySettingsWire & { projectId: number }>;
    };
    return body.projects;
  }
}
