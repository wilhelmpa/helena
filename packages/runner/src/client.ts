import type { AgUiEvent, ContextUsage } from './agui';
import type { RunnerConfig } from './config';
import type { LoginUse, WebLogin, WorkRef } from './logins';
import type { RuntimePolicySnapshot, RuntimeStatus } from './policy';

// The agent's API key is the whole authorization: it identifies the agent, and the server
// only ever hands back that agent's work.

export interface Run {
  id: number;
  trigger: 'mention' | 'delegation' | 'field' | 'schedule' | 'manual' | 'approval';
  prompt: string;
  systemPrompt: string;
  issueId: number | null;
  issueIdentifier: string | null;
  model: string | null;
  thinkingLevel: string | null;
  // Absent on a server that predates run limits.
  maxTurns?: number | null;
  runBudgetSeconds?: number | null;
  // The folder of the issue's area below `cwd`, where the run starts. Absent on a server
  // that predates area folders.
  workdir?: string | null;
}

// `prompt` carries the conversation so far framed into a task — unless `sessionId` is set,
// where the coding agent session already holds it and only the new message is sent. Null
// there means no session yet: start one and report the id it got.
export interface ChatMessage {
  id: number;
  threadId: string;
  prompt: string;
  systemPrompt: string;
  sessionId: string | null;
  model: string | null;
  thinkingLevel: string | null;
}

// None of these calls does real work on the server, so a request that hangs is a dead
// connection. Without a deadline it would never settle and the runner would stop polling.
const REQUEST_TIMEOUT_MS = 30_000;

// Claiming a chat message is the one call that does wait: the server holds it until a
// message turns up, so the answer starts the moment it is sent. The deadline has to
// outlast that wait, or the runner would abort every idle claim.
const CHAT_CLAIM_TIMEOUT_MS = 35_000;

// The status is carried so the caller can tell a rejected key from a server that is down.
export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class Client {
  constructor(private readonly config: RunnerConfig) {}

  private async get(path: string): Promise<Response> {
    const res = await fetch(`${this.config.url}${path}`, {
      headers: { 'x-api-key': this.config.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new RequestError(
        res.status,
        `GET ${path} failed with ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    }
    return res;
  }

  private async post(
    path: string,
    body?: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Response> {
    const res = await fetch(`${this.config.url}${path}`, {
      method: 'POST',
      headers: {
        'x-api-key': this.config.apiKey,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new RequestError(
        res.status,
        `POST ${path} failed with ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    }
    return res;
  }

  async runtimePolicy(): Promise<RuntimePolicySnapshot> {
    return (await (await this.get('/agent-runtime/policy')).json()) as RuntimePolicySnapshot;
  }

  // The values of the secrets the agent's MCP servers name, by secret id. Named with the
  // run or chat answer they are for, the read is recorded in Plan's audit log.
  async mcpSecrets(work?: WorkRef): Promise<Record<string, string>> {
    const query = work ? `?${new URLSearchParams(workParams(work))}` : '';
    const body = (await (await this.get(`/agent-runtime/mcp-secrets${query}`)).json()) as {
      secrets?: Record<string, string>;
    };
    return body.secrets ?? {};
  }

  // The website logins granted to the agent, for the run or chat answer it holds.
  async webLogins(work: WorkRef): Promise<WebLogin[]> {
    const path =
      'runId' in work
        ? `/agent-runs/${work.runId}/web-logins`
        : `/agent-chats/${work.messageId}/web-logins`;
    const body = (await (await this.get(path)).json()) as { logins?: WebLogin[] };
    return body.logins ?? [];
  }

  async reportLoginUses(work: WorkRef, uses: LoginUse[]): Promise<void> {
    await this.post('/agent-runtime/credential-uses', { ...work, uses });
  }

  async reportRuntimeStatus(status: RuntimeStatus): Promise<void> {
    await this.post('/agent-runtime/status', status);
  }

  async claim(): Promise<Run | null> {
    const res = await this.post('/agent-runs/claim');
    const body = (await res.json()) as { run: Run | null };
    return body.run;
  }

  // True when the run was canceled, for instance with the workflow run of its stage.
  async heartbeat(runId: number): Promise<boolean> {
    return canceled(await this.post(`/agent-runs/${runId}/heartbeat`));
  }

  // `usage` is what the run read and wrote: its totals where the command reports them
  // (Hermes), otherwise its last model call. Left out where the command reported
  // nothing about it, which stores the run without counts.
  async report(
    runId: number,
    result: {
      status: 'success' | 'failed';
      output?: string;
      error?: string;
      usage?: ContextUsage | null;
    },
  ): Promise<void> {
    await this.post(`/agent-runs/${runId}/result`, result);
  }

  async claimChat(): Promise<ChatMessage | null> {
    const res = await this.post('/agent-chats/claim', undefined, CHAT_CLAIM_TIMEOUT_MS);
    const body = (await res.json()) as { message: ChatMessage | null };
    return body.message;
  }

  async publishChatCatalog(models: RunnerConfig['models']): Promise<void> {
    await this.post('/agent-chats/catalog', { models });
  }

  // `sessionId` binds the thread to that session for every later message in it. True
  // when the member stopped the answer: the server has no connection to this machine, so
  // the stop is returned on the calls the runner already makes.
  async chatEvents(messageId: number, events: AgUiEvent[], sessionId?: string): Promise<boolean> {
    const res = await this.post(`/agent-chats/${messageId}/events`, {
      events,
      ...(sessionId && { sessionId }),
    });
    return canceled(res);
  }

  // True when the member stopped the answer. This is how a command that is writing
  // nothing learns of the stop.
  async chatHeartbeat(messageId: number): Promise<boolean> {
    return canceled(await this.post(`/agent-chats/${messageId}/heartbeat`));
  }

  // `usage` is the size of the context the answer left behind. Left out where the
  // command reported nothing about it, which keeps the number the thread already has.
  async chatResult(
    messageId: number,
    result: {
      status: 'success' | 'failed';
      error?: string;
      usage?: ContextUsage | null;
      sessionLost?: boolean;
    },
  ): Promise<void> {
    await this.post(`/agent-chats/${messageId}/result`, result);
  }
}

function workParams(work: WorkRef): Record<string, string> {
  return 'runId' in work ? { runId: String(work.runId) } : { messageId: String(work.messageId) };
}

// An instance too old to know about stopping answers this with 204 and no body, which
// reads the same way as work nobody stopped.
async function canceled(res: Response): Promise<boolean> {
  const body = (await res.json().catch(() => ({}))) as { canceled?: boolean };
  return body.canceled === true;
}
