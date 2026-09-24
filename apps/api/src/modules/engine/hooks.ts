import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Webhook } from 'standardwebhooks';
import { db, helenaWorkflowHook, pipeline, pipelineVersion, projectPipeline } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import type { PipelineDefinition } from '#modules/pipelines/definition';
import { createRun } from '#modules/pipelines/runs';
import { startRunSoon } from './runs';
import { newWebhookSecret, openSecret, sealSecret } from './secrets';

// The inbound webhook of a builder workflow with a webhook trigger: a sender posts to
// /hooks/workflows/<id>, signed per Standard Webhooks with the hook's secret (or with
// the secret as a bearer token, for senders that cannot sign), and every accepted request
// creates a task and runs the workflow on it. The same `webhook-id` starts one run only.

const MAX_BODY = 64 * 1024;

// The hook's path on the api; the web puts the api's public address in front of it.
export function hookUrl(id: string): string {
  return `/hooks/workflows/${id}`;
}

async function usage(projectId: number, pipelineId: number) {
  const [row] = await db
    .select({ enabled: projectPipeline.enabled, definition: pipelineVersion.definition })
    .from(projectPipeline)
    .innerJoin(pipeline, eq(pipeline.id, projectPipeline.pipelineId))
    .innerJoin(
      pipelineVersion,
      and(
        eq(pipelineVersion.pipelineId, pipeline.id),
        eq(pipelineVersion.version, pipeline.version),
      ),
    )
    .where(
      and(eq(projectPipeline.projectId, projectId), eq(projectPipeline.pipelineId, pipelineId)),
    );
  return row ?? null;
}

export async function getHook(projectId: number, pipelineId: number) {
  const [row] = await db
    .select()
    .from(helenaWorkflowHook)
    .where(
      and(
        eq(helenaWorkflowHook.projectId, projectId),
        eq(helenaWorkflowHook.pipelineId, pipelineId),
      ),
    );
  return row
    ? {
        id: row.id,
        url: hookUrl(row.id),
        createdAt: iso(row.createdAt),
        lastUsedAt: row.lastUsedAt ? iso(row.lastUsedAt) : null,
      }
    : null;
}

// Creates the hook of the workflow in the project, or gives it a new secret. The secret
// is answered this once.
export async function createHook(projectId: number, pipelineId: number, userId: string) {
  const current = await usage(projectId, pipelineId);
  if (!current) throw new HttpError(404, 'Workflow not found');
  if ((current.definition as PipelineDefinition).trigger.type !== 'webhook')
    throw new HttpError(409, 'The workflow does not start on a webhook');
  const secret = newWebhookSecret();
  const id = `hk_${randomBytes(18).toString('base64url')}`;
  const [row] = await db
    .insert(helenaWorkflowHook)
    .values({ id, projectId, pipelineId, secret: sealSecret(secret), createdBy: userId })
    .onConflictDoUpdate({
      target: [helenaWorkflowHook.projectId, helenaWorkflowHook.pipelineId],
      set: { secret: sealSecret(secret), createdBy: userId, createdAt: new Date() },
    })
    .returning();
  return { id: row!.id, url: hookUrl(row!.id), secret };
}

export async function deleteHook(projectId: number, pipelineId: number): Promise<void> {
  await db
    .delete(helenaWorkflowHook)
    .where(
      and(
        eq(helenaWorkflowHook.projectId, projectId),
        eq(helenaWorkflowHook.pipelineId, pipelineId),
      ),
    );
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

// Accepts one request to a hook: checks the signature (or bearer), and starts a run of
// the workflow on a task it creates. Answers the run.
export async function receiveHook(id: string, request: Request): Promise<{ runId: string }> {
  const [hook] = await db.select().from(helenaWorkflowHook).where(eq(helenaWorkflowHook.id, id));
  if (!hook) throw new HttpError(404, 'Not found');
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY) throw new HttpError(413, 'The request is too large');
  const secret = openSecret(hook.secret);
  const headers = Object.fromEntries(request.headers);
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let messageId: string;
  if (headers['webhook-signature']) {
    try {
      new Webhook(secret).verify(raw, headers);
    } catch {
      throw new HttpError(401, 'The signature is invalid');
    }
    messageId = headers['webhook-id'] ?? '';
  } else if (bearer && equal(bearer, secret)) {
    messageId = headers['webhook-id'] ?? headers['idempotency-key'] ?? '';
  } else throw new HttpError(401, 'The request is not signed');
  let body: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        body = parsed as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'The body is not JSON');
    }
  }
  const current = await usage(hook.projectId, hook.pipelineId);
  const trigger = (current?.definition as PipelineDefinition | undefined)?.trigger;
  if (!current?.enabled || trigger?.type !== 'webhook')
    throw new HttpError(409, 'The workflow does not run on this webhook');
  const runId = messageId
    ? `hook-${createHash('sha256').update(`${hook.id}\0${messageId}`).digest('hex').slice(0, 40)}`
    : undefined;
  const title = text(body.title, 300) ?? trigger.title;
  const description =
    text(body.description, 20_000) ??
    (raw.trim() ? `\`\`\`json\n${raw.slice(0, 8_000)}\n\`\`\`` : '');
  const run = await createRun({
    ...(runId ? { id: runId } : {}),
    pipelineId: hook.pipelineId,
    projectId: hook.projectId,
    issueId: null,
    trigger: 'webhook',
    dryRun: false,
    actorUserId: hook.createdBy,
    input: { task: { title, description }, request: body },
  });
  await db
    .update(helenaWorkflowHook)
    .set({ lastUsedAt: new Date() })
    .where(eq(helenaWorkflowHook.id, hook.id));
  if (run) await startRunSoon(run.id);
  return { runId: run?.id ?? runId ?? '' };
}
