import { createHash } from 'node:crypto';
import { pinnedFetch, UrlNotAllowedError } from '@repo/net';
import { Webhook } from 'standardwebhooks';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { LIMITS, type WebhookStep } from '#modules/pipelines/definition';
import { renderTemplate } from '#modules/pipelines/render';
import { clip, loadRun, renderContext, stepRow, writeStep } from '../../run-context';
import { projectSigningSecret } from '../../secrets';
import type { StepContext, StepExecution, WorkflowStepType } from '../../sdk';

// A webhook: posts the run, its task, the results so far and a message to a URL, signed
// per Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`) with the
// project's signing secret. `webhook-id` is the same for every try of one execution, so
// the receiver can drop a repeat. A 2xx answer is success; anything else is the outcome
// `failed`, which an outcome condition can branch on. The URL must be public: a private
// or local address is refused like any other server-side fetch of a given URL.

type Step = WebhookStep & { [field: string]: unknown };

const TRIES = 3;
const TIMEOUT_MS = 15_000;

async function send(
  runId: string,
  step: WebhookStep,
  at: StepExecution,
): Promise<{ outcome: 'success' | 'failed'; summary: string }> {
  const existing = await stepRow(runId, at);
  if (existing && ['succeeded', 'simulated'].includes(existing.status))
    return { outcome: 'success', summary: existing.summary ?? '' };
  const context = await loadRun(runId);
  const variables = await renderContext(context, at.seq);
  const message = renderTemplate(step.message, variables);
  if (context.run.dryRun) {
    const summary = `POST ${step.url}`;
    await writeStep(runId, step, at, {
      status: 'simulated',
      outcome: 'success',
      summary,
      finishedAt: new Date(),
    });
    return { outcome: 'success', summary };
  }
  const id = `msg_${createHash('sha256')
    .update(`${runId}\0${at.stepId}\0${at.iteration}\0${existing?.attempt ?? 1}`)
    .digest('hex')
    .slice(0, 32)}`;
  const body = JSON.stringify({
    type: 'helena.workflow.step',
    run: {
      id: runId,
      workflow: context.name,
      version: context.version,
      project: context.project.key,
    },
    step: { id: step.id, name: step.name },
    task: context.task
      ? {
          identifier: context.task.identifier,
          title: context.task.title,
          status: variables.task.status,
        }
      : null,
    message,
    previous: variables.previous,
    steps: variables.steps,
  });
  const signer = new Webhook(await projectSigningSecret(context.project.id));
  let outcome: 'success' | 'failed' = 'failed';
  let summary = '';
  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    const timestamp = new Date();
    try {
      const response = await pinnedFetch(step.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'webhook-id': id,
          'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
          'webhook-signature': signer.sign(id, timestamp, body),
        },
        body,
        timeoutMs: TIMEOUT_MS,
        maxBytes: 64 * 1024,
        truncateBody: true,
      });
      const text = (await response.text().catch(() => '')).trim();
      summary = clip(`HTTP ${response.status}${text ? `: ${text}` : ''}`);
      if (response.ok) {
        outcome = 'success';
        break;
      }
      if (response.status < 500 && response.status !== 408 && response.status !== 429) break;
    } catch (error) {
      summary =
        error instanceof UrlNotAllowedError
          ? `The URL is not allowed: ${error.message}`
          : `The request failed: ${error instanceof Error ? error.message : String(error)}`;
      if (error instanceof UrlNotAllowedError) break;
    }
    if (attempt < TRIES) await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
  }
  await writeStep(runId, step, at, {
    status: outcome === 'success' ? 'succeeded' : 'failed',
    outcome,
    summary,
    error: outcome === 'success' ? null : summary,
    finishedAt: new Date(),
  });
  await bumpControlPlaneRevision(context.project.id);
  return { outcome, summary };
}

export const webhookStep: WorkflowStepType<Step> = {
  type: 'webhook',
  ui: { builder: true, icon: 'webhook' },
  category: 'send',
  producesResult: true,
  read(value, reader) {
    const url = reader.text(value.url, 'url', 2_000);
    if (url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
          reader.issue('invalid_url', 'url');
      } catch {
        reader.issue('invalid_url', 'url');
      }
    }
    return { url, message: reader.text(value.message ?? '', 'message', LIMITS.message, false) };
  },
  templateFields: (step) => [{ field: 'message', text: step.message }],
  async execute(context: StepContext<Step>) {
    const sent = await context.op('send', () =>
      send(context.run.id, context.step, context.execution),
    );
    return { kind: 'continue', outcome: sent.outcome, summary: sent.summary };
  },
};
