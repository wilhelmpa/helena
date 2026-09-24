import type { AgUiEvent, ContextUsage } from './agui';
import type { RunnerConfig } from './config';
import type { LoginUse, WebLogin, WorkRef } from './logins';
import type { RuntimePolicySnapshot, RuntimeStatus } from './policy';
import type { RuntimeRequest } from './readers';
import type { Spend } from './spend';
import type { RunModelReport } from './runtime';

// The agent's API key is the whole authorization: it identifies the agent, and the server
// only ever hands back that agent's work.

export interface Run {
  id: number;
  trigger: 'mention' | 'delegation' | 'field' | 'schedule' | 'manual' | 'approval';
  prompt: string;
  systemPrompt: string;
  attempts: number;
  // Names this claim on every heartbeat, result and release, so the server can tell the
  // runner that the run was claimed again after its lease ran out. It changes when this
  // runner claims the run again. Absent on a server that predates it.
  claim?: number;
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
  // The coding agent session to resume, when the runner that held this run before died
  // mid run and reported one. Absent on a server that predates run resume.
  sessionId?: string | null;
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
  // Absolute paths of the images attached to the question. Older servers send none.
  images?: string[];
}

// A follow-up turn in the session of a finished run, in which the agent keeps what the run
// taught it. Plan writes the prompt and sets the limits.
export interface ReflectionRequest {
  prompt: string;
  maxTurns: number;
  runBudgetSeconds: number;
}

// What the agent saved in a reflection: one entry per memory or skill write that succeeded.
export interface ReflectionSaved {
  tool: 'memory' | 'skill';
  action: string;
  target: string;
}

export interface ReflectionReport {
  status: 'success' | 'failed';
  usage?: ContextUsage | null;
  spend?: Spend | null;
  saved: ReflectionSaved[];
  summary?: string | null;
  error?: string | null;
}

// A question Helena asks the agent's runtime: a session, a transcript, the logs, its health.
// The runner answers it with the adapter of the agent's runtime (readers/).
export interface RuntimeRequestClaim {
  id: number;
  request: RuntimeRequest;
}

export type RuntimeRequestAnswer = { ok: true; result: unknown } | { ok: false; error: string };

// None of these calls does real work on the server, so a request that hangs is a dead
// connection. Without a deadline it would never settle and the runner would stop polling.
const REQUEST_TIMEOUT_MS = 30_000;

// Claiming a chat message is the one call that does wait: the server holds it until a
// message turns up, so the answer starts the moment it is sent. The deadline has to
// outlast that wait, or the runner would abort every idle claim.
const CHAT_CLAIM_TIMEOUT_MS = 35_000;

// An answer to a runtime request can be a few megabytes of transcript.
const ANSWER_TIMEOUT_MS = 60_000;

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

  // That the runner started (null) or why its service could not start it, for Helena's
  // health overview. A server that predates the route answers 404.
  async reportRunnerHealth(error: string | null): Promise<void> {
    await this.post('/agent-runtime/runner-health', { error });
  }

  async claim(): Promise<Run | null> {
    const res = await this.post('/agent-runs/claim');
    const body = (await res.json()) as { run: Run | null };
    return body.run;
  }

  // True when the run was canceled, for instance with the workflow run of its stage, or
  // is no longer this runner's: claimed again, finished, or deleted.
  async heartbeat(runId: number, claim?: number): Promise<boolean> {
    return (await this.beat(runId, claim)).canceled;
  }

  // `hold` is set while the instance's emergency stop is on: the runner stops the command
  // and hands the run back, which resumes its session once the stop is lifted.
  async beat(runId: number, claim?: number): Promise<{ canceled: boolean; hold: boolean }> {
    try {
      const res = await this.post(`/agent-runs/${runId}/heartbeat${claimQuery(claim)}`);
      const body = (await res.json().catch(() => ({}))) as { canceled?: boolean; hold?: boolean };
      return { canceled: body.canceled === true, hold: body.hold === true };
    } catch (err) {
      if (err instanceof RequestError && err.status === 404) return { canceled: true, hold: false };
      throw err;
    }
  }

  // Hands a run back to the queue without spending its attempt, for a runner that stops.
  async release(runId: number, claim: number): Promise<void> {
    await this.post(`/agent-runs/${runId}/release${claimQuery(claim)}`);
  }

  // Saves this run's coding agent session as soon as it is known, not only with the
  // final result: a crash before the result still leaves a session the next claim can
  // resume. Best effort -- a stale claim (the run was claimed again) is not fatal, so
  // the runner keeps working and swallows the refusal itself.
  async reportSession(runId: number, claim: number | undefined, sessionId: string): Promise<void> {
    await this.post(`/agent-runs/${runId}/session${claimQuery(claim)}`, { sessionId });
  }

  // `usage` is what the run read and wrote: its totals where the command reports them
  // (Hermes), otherwise its last model call. Left out where the command reported
  // nothing about it, which stores the run without counts.
  // A 404 means the run is no longer this runner's to report. The answer names the
  // reflection Plan asks for, if any. An older server answers 204.
  async report(
    runId: number,
    claim: number | undefined,
    result: {
      status: 'success' | 'failed';
      output?: string;
      error?: string;
      usage?: ContextUsage | null;
      sessionId?: string;
      toolCalls?: number;
      // Every model call of the run summed, with the model that ran, for the token ledger.
      spend?: Spend | null;
      // The model and reasoning requested, the runtime's defaults and what really ran.
      runtime?: RunModelReport;
    },
  ): Promise<ReflectionRequest | null> {
    const res = await this.post(`/agent-runs/${runId}/result${claimQuery(claim)}`, result);
    const body = (await res.json().catch(() => ({}))) as { reflection?: ReflectionRequest | null };
    return body.reflection ?? null;
  }

  async reportReflection(runId: number, reflection: ReflectionReport): Promise<void> {
    await this.post(`/agent-runs/${runId}/reflection`, reflection);
  }

  // The run's command output as AG-UI events, for the run's timeline in Helena while it runs.
  // True when the run was canceled or is no longer this runner's, as with the heartbeat.
  async runEvents(runId: number, claim: number | undefined, events: AgUiEvent[]): Promise<boolean> {
    return gone(() => this.post(`/agent-runs/${runId}/events${claimQuery(claim)}`, { events }));
  }

  // Waits on the server like the chat claim does, so an answer starts as soon as it is asked.
  async claimRuntimeRequest(): Promise<RuntimeRequestClaim | null> {
    const res = await this.post('/agent-runtime/requests/claim', undefined, CHAT_CLAIM_TIMEOUT_MS);
    const body = (await res.json()) as { request: RuntimeRequestClaim | null };
    return body.request;
  }

  async answerRuntimeRequest(id: number, answer: RuntimeRequestAnswer): Promise<void> {
    await this.post(`/agent-runtime/requests/${id}/answer`, answer, ANSWER_TIMEOUT_MS);
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
    return gone(() => this.post(`/agent-chats/${messageId}/heartbeat`));
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
      model?: string;
      spend?: Spend | null;
      runtime?: RunModelReport;
    },
  ): Promise<void> {
    await this.post(`/agent-chats/${messageId}/result`, result);
  }
}

function workParams(work: WorkRef): Record<string, string> {
  return 'runId' in work ? { runId: String(work.runId) } : { messageId: String(work.messageId) };
}

function claimQuery(claim: number | undefined): string {
  return claim === undefined ? '' : `?claim=${claim}`;
}

// An instance too old to know about stopping answers this with 204 and no body, which
// reads the same way as work nobody stopped.
async function canceled(res: Response): Promise<boolean> {
  const body = (await res.json().catch(() => ({}))) as { canceled?: boolean };
  return body.canceled === true;
}

// A heartbeat the server answers with 404 names work that is not there any more: it was
// finished, or deleted with its agent or issue. The command is stopped as for a cancel.
async function gone(send: () => Promise<Response>): Promise<boolean> {
  try {
    return await canceled(await send());
  } catch (err) {
    if (err instanceof RequestError && err.status === 404) return true;
    throw err;
  }
}

// A request the server may answer differently later: it was not reached, or failed on
// its side. A 4xx answer is final.
export function isTransient(err: unknown): boolean {
  return !(err instanceof RequestError) || err.status >= 500 || err.status === 429;
}
