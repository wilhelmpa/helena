import { createHmac, randomUUID } from 'node:crypto';
import { pinnedFetch } from '@repo/net';
import type { RunnerConfig } from './config';
import type { Outcome, Task, ExecuteOptions } from './execute';
import { externalResult } from './external-result';

const MAX_RESPONSE_BYTES = 64 * 1024;

export function signWebhook(id: string, timestamp: string, body: string, secret: string): string {
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) {
    throw new Error('Webhook signing secret must use the whsec_ base64 format');
  }
  const key = Buffer.from(secret.slice(6), 'base64');
  if (key.length < 24 || key.length > 64 || `whsec_${key.toString('base64')}` !== secret) {
    throw new Error('Webhook signing secret must contain 24 to 64 random bytes');
  }
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

function requestId(task: Task): string {
  const runId = task.env.ITSAPLAN_RUN_ID;
  const messageId = task.env.ITSAPLAN_MESSAGE_ID;
  if (runId && /^\d+$/.test(runId)) return `msg_run_${runId}`;
  if (messageId && /^\d+$/.test(messageId)) return `msg_chat_${messageId}`;
  return `msg_${randomUUID().replaceAll('-', '')}`;
}

export async function executeWebhook(
  config: RunnerConfig,
  task: Task,
  opts: ExecuteOptions,
  send: typeof pinnedFetch = pinnedFetch,
): Promise<Outcome> {
  const url = task.env.HELENA_WEBHOOK_URL;
  const secretName = task.env.HELENA_WEBHOOK_SECRET_ENV;
  const secret = secretName ? task.env[secretName] : undefined;
  if (!url || !secret) {
    return {
      status: 'failed',
      output: '',
      error: 'Webhook URL or granted signing secret is missing',
    };
  }
  try {
    if (new URL(url).protocol !== 'https:') throw new Error();
  } catch {
    return { status: 'failed', output: '', error: 'Webhook URL must use HTTPS' };
  }
  const id = requestId(task);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({
    type: task.env.ITSAPLAN_RUN_ID ? 'agent.run' : 'agent.chat',
    id,
    data: {
      prompt: task.prompt,
      systemPrompt: task.systemPrompt,
      runId: task.env.ITSAPLAN_RUN_ID || null,
      messageId: task.env.ITSAPLAN_MESSAGE_ID || null,
      issue: task.env.ITSAPLAN_ISSUE || null,
      sessionId: task.sessionId ?? null,
      model: task.model ?? null,
      thinkingLevel: task.thinkingLevel ?? null,
      maxTurns: task.maxTurns ?? null,
      runBudgetSeconds: task.runBudgetSeconds ?? null,
      autopilotLevel: task.autopilotLevel ?? null,
    },
  });
  let signature: string;
  try {
    signature = signWebhook(id, timestamp, body, secret);
  } catch (error) {
    return {
      status: 'failed',
      output: '',
      error: error instanceof Error ? error.message : 'Invalid signing secret',
    };
  }
  const timeout = Math.min(config.timeoutMs, (task.runBudgetSeconds ?? Infinity) * 1000);
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeout)])
    : AbortSignal.timeout(timeout);
  try {
    const response = await send(url, {
      publicOnly: true,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': id,
        'webhook-timestamp': timestamp,
        'webhook-signature': signature,
      },
      body,
      signal,
      timeoutMs: timeout,
      maxBytes: MAX_RESPONSE_BYTES,
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        status: 'failed',
        output: '',
        error: `Webhook answered HTTP ${response.status}: ${text.slice(0, 400)}`,
      };
    }
    if (response.headers.get('content-type')?.includes('application/json')) {
      try {
        JSON.parse(text);
      } catch {
        return { status: 'failed', output: '', error: 'Webhook returned invalid JSON' };
      }
    }
    const result = externalResult(text, 'webhook');
    if (result.status === 'success') opts.onData?.(result.output);
    return result;
  } catch (error) {
    return {
      status: 'failed',
      output: '',
      error: error instanceof Error ? error.message.slice(0, 400) : 'Webhook request failed',
    };
  }
}
