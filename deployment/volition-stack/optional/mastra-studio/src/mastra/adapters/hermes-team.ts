import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  stageResultSchema,
  type AgentTeamPayload,
  type Delegation,
  type SpecialistResult,
  type StageResult,
  type TeamPolicy,
} from '../team-contracts.ts';
import type { WorkEnvelope } from '../contracts.ts';

export type TeamPhase = 'coordinate' | 'specialize' | 'review';

export interface StageRequest {
  phase: TeamPhase;
  idempotencyKey: string;
  projectRef: string;
  task: AgentTeamPayload['task'];
  agent: AgentTeamPayload['coordinator'];
  allowedSpecialists?: AgentTeamPayload['specialists'];
  assignment?: Delegation;
  // The results of the assignments this one depends on.
  dependencyResults?: Pick<SpecialistResult, 'assignmentId' | 'summary' | 'evidence'>[];
  specialistResults?: SpecialistResult[];
  policy: TeamPolicy;
  execution: AgentTeamPayload['execution'];
}

export interface PlanSyncRequest {
  idempotencyKey: string;
  projectRef: string;
  taskRef: string;
  state: 'review' | 'done';
  summary: string;
  evidence: StageResult['evidence'];
}

export interface HermesTeamAdapter {
  // `signal` is the abort signal of the workflow step, which fires when the run is
  // canceled.
  executeStage(request: StageRequest, signal?: AbortSignal): Promise<StageResult>;
  synchronizePlan(request: PlanSyncRequest): Promise<{ synchronizedAt: string }>;
}

export function teamIdempotencyKey(
  envelope: Pick<WorkEnvelope, 'eventId' | 'correlationId'>,
  phase: string,
  subject: string,
): string {
  return createHash('sha256')
    .update(`agent-team\0${envelope.eventId}\0${envelope.correlationId}\0${phase}\0${subject}`)
    .digest('hex');
}

export async function withBackoff<T>(
  policy: Pick<TeamPolicy, 'maxAttempts' | 'initialBackoffMs' | 'maxBackoffMs' | 'backoffMultiplier'>,
  operation: (attempt: number) => Promise<T>,
  signal?: AbortSignal,
  wait: (milliseconds: number, signal?: AbortSignal) => Promise<void> = (milliseconds, signal) =>
    sleep(milliseconds, undefined, { signal }).catch(() => {}),
): Promise<T> {
  let delay = policy.initialBackoffMs;
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === policy.maxAttempts) break;
      await wait(delay, signal);
      delay = Math.min(policy.maxBackoffMs, Math.ceil(delay * policy.backoffMultiplier));
    }
  }
  throw lastError;
}

function validateLease(result: StageResult, policy: TeamPolicy): StageResult {
  const claimedAt = Date.parse(result.lease.claimedAt);
  const heartbeatAt = Date.parse(result.lease.heartbeatAt);
  const expiresAt = Date.parse(result.lease.expiresAt);
  const completedAt = Date.parse(result.completedAt);
  if (
    heartbeatAt < claimedAt ||
    completedAt < heartbeatAt ||
    expiresAt < completedAt ||
    completedAt - heartbeatAt > policy.heartbeatSeconds * 1_000 + 5_000
  ) {
    throw new Error('Hermes returned an invalid execution lease');
  }
  if (expiresAt - heartbeatAt > policy.leaseSeconds * 1_000 + 5_000) {
    throw new Error('Hermes returned a lease outside the requested bound');
  }
  return result;
}

async function token(): Promise<string> {
  const path = process.env.HERMES_TEAM_TOKEN_FILE;
  if (!path || (!path.startsWith('/run/secrets/') && !path.startsWith('/run/credentials/'))) {
    throw new Error('The Hermes team token file is invalid');
  }
  const value = (await readFile(path, 'utf8')).trim();
  if (Buffer.byteLength(value) < 32 || value.length > 2_048) {
    throw new Error('The Hermes team token is invalid');
  }
  return value;
}

function socketPath(): string {
  const value = process.env.HERMES_TEAM_SOCKET ?? '/run/volition-ipc/hermes-team.sock';
  if (!value.startsWith('/run/volition-ipc/') || !value.endsWith('.sock')) {
    throw new Error('The Hermes team socket path is invalid');
  }
  return value;
}

// The bridge answers a stage only once its Hermes run has finished, so a stage
// request waits as long as the stage timeout allows. Aborting it closes the
// connection, which makes the bridge cancel the stage's Plan run.
export async function bridgeRequest(
  path: string,
  body: unknown,
  timeoutMs = 330_000,
  signal?: AbortSignal,
): Promise<unknown> {
  const auth = await token();
  const encoded = JSON.stringify(body);
  return await new Promise((resolve, reject) => {
    const call = http.request({
      socketPath: socketPath(),
      path,
      method: 'POST',
      signal,
      headers: {
        authorization: `Bearer ${auth}`,
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(encoded)),
      },
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 512 * 1024) call.destroy(new Error('Hermes response is too large'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
          return reject(new Error(`Hermes team bridge returned HTTP ${response.statusCode ?? 500}`));
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('Hermes team bridge returned invalid JSON'));
        }
      });
    });
    call.setTimeout(timeoutMs, () => call.destroy(new Error('Hermes team bridge timed out')));
    call.on('error', reject);
    call.end(encoded);
  });
}

export const privateHermesTeamAdapter: HermesTeamAdapter = {
  async executeStage(input, signal) {
    return withBackoff(
      input.policy,
      async attempt => {
        const raw = await bridgeRequest(
          '/internal/hermes/team/stages',
          { schemaVersion: 1, ...input, attempt },
          (input.policy.timeoutSeconds + 30) * 1_000,
          signal,
        );
        const result = validateLease(stageResultSchema.parse(raw), input.policy);
        if (result.idempotencyKey !== input.idempotencyKey || result.phase !== input.phase) {
          throw new Error('Hermes returned a result for another execution stage');
        }
        if (result.status === 'failed') throw new Error('Hermes execution stage failed');
        return result;
      },
      signal,
    );
  },
  async synchronizePlan(input) {
    const raw = await bridgeRequest('/internal/hermes/team/synchronize', { schemaVersion: 1, ...input });
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Hermes team bridge returned an invalid synchronization result');
    }
    const value = raw as Record<string, unknown>;
    if (value.idempotencyKey !== input.idempotencyKey || typeof value.synchronizedAt !== 'string') {
      throw new Error('Hermes team bridge returned an invalid synchronization result');
    }
    if (!Number.isFinite(Date.parse(value.synchronizedAt))) {
      throw new Error('Hermes team bridge returned an invalid synchronization timestamp');
    }
    return { synchronizedAt: new Date(value.synchronizedAt).toISOString() };
  },
};
