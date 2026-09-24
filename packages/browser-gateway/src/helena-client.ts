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
  // The page size while an agent controls the browser (older Helena: absent).
  agentViewport?: { width: number; height: number };
}

export interface ResolveResult {
  agentId: number;
  agentName: string;
  teamId: number;
  // Null for Home's own browser, which belongs to no project.
  projectId: number | null;
  projectKey: string | null;
  browserGatewayEnabled: boolean;
  settings: BrowserGatewaySettingsWire;
}

export interface WorkRef {
  runId?: number;
  messageId?: number;
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

export class HelenaApiError extends Error {
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

export interface HelenaClientOptions {
  baseUrl: string; // e.g. http://127.0.0.1:3000
  serviceToken: string;
  fetchImpl?: typeof fetch;
}

export class HelenaClient {
  #baseUrl: string;
  #token: string;
  #fetch: typeof fetch;

  constructor(options: HelenaClientOptions) {
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
      throw new HelenaApiError(res.status, message);
    }
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  // `via` is the slug of the socket the call came through: Helena checks that only the
  // Home-Master calls through Home's socket, and that nobody else names another project.
  resolve(agentKey: string, projectSlug: string, via: string): Promise<ResolveResult> {
    return this.#post('/internal/browser-gateway/resolve', { agentKey, projectSlug, via });
  }

  login(
    agentKey: string,
    projectSlug: string,
    via: string,
    frameOrigin: string,
    credentialId?: number,
    work?: WorkRef,
  ): Promise<LoginResult> {
    return this.#post('/internal/browser-gateway/login', {
      agentKey,
      projectSlug,
      via,
      frameOrigin,
      credentialId,
      ...work,
    });
  }

  loginCode(
    agentKey: string,
    credentialId: number,
    frameOrigin: string,
    work?: WorkRef,
  ): Promise<LoginCodeResult> {
    return this.#post('/internal/browser-gateway/login-code', {
      agentKey,
      credentialId,
      frameOrigin,
      ...work,
    });
  }

  audit(input: {
    agentKey: string;
    projectSlug: string;
    via: string;
    actor: 'agent' | 'owner';
    tool: string;
    category?: string;
    target?: string;
  }): Promise<void> {
    return this.#post('/internal/browser-gateway/audit', input);
  }

  // browser_handover: a card in Helena's Freigaben (a project's browser only; Home's own
  // browser has no project to file it under, so approvalId is null there).
  handover(input: {
    agentKey: string;
    projectSlug: string;
    via: string;
    reason: string;
    runId?: number;
    messageId?: number;
  }): Promise<{ approvalId: number | null }> {
    return this.#post('/internal/browser-gateway/handover', input);
  }

  // Closes the card once the owner gave control back (finished), or leaves it open.
  handoverDone(input: { approvalId: number; finished: boolean }): Promise<void> {
    return this.#post('/internal/browser-gateway/handover-done', input);
  }

  // The policy's answer for one call (docs/volition-helena-oss.md §3a "Richtlinien"): its
  // action category and what it acts on. 'approve' filed a card in Freigaben (approvalId).
  decide(input: {
    agentKey: string;
    projectSlug: string;
    via: string;
    tool: string;
    category: string;
    context: { origin: string | null; target: string | null; formAction: string | null };
    runId?: number;
    messageId?: number;
  }): Promise<{
    decision: 'allow' | 'deny' | 'approve';
    reason?: string;
    approvalId?: number | null;
  }> {
    return this.#post('/internal/browser-gateway/decide', input);
  }

  // A file the browser downloaded, into the project's Inbox folder (Home: Home/Inbox).
  // `agentKey` names the agent that controlled the browser, if one did.
  download(input: {
    projectSlug: string;
    agentKey: string | null;
    fileName: string;
    data: string;
  }): Promise<{ path: string }> {
    return this.#post('/internal/browser-gateway/download', input);
  }

  async policy(): Promise<Record<string, BrowserGatewaySettingsWire & { projectId: number }>> {
    const res = await this.#fetch(`${this.#baseUrl}/internal/browser-gateway/policy`, {
      headers: { authorization: `Bearer ${this.#token}` },
    });
    if (!res.ok) throw new HelenaApiError(res.status, await res.text());
    const body = (await res.json()) as {
      projects: Record<string, BrowserGatewaySettingsWire & { projectId: number }>;
    };
    return body.projects;
  }
}
