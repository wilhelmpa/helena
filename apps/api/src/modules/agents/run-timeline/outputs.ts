import { db, agentRun, agentRunOutput } from '@repo/db';
import { and, asc, eq } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { assertMcpAllowed } from '#shared/guards';

export type OutputKind = 'file' | 'preview' | 'pr' | 'screenshot';
export type OutputSource = 'reported' | 'inferred';
export type RunOutputInput = { kind: OutputKind; title: string; target: string };

export async function reportRunOutput(
  agentId: number,
  runId: number,
  output: RunOutputInput,
  headers: Headers,
) {
  if (
    (output.kind === 'preview' || output.kind === 'pr') &&
    !/^https?:\/\/[^\s]+$/i.test(output.target)
  ) {
    throw new HttpError(400, 'Links must use HTTP or HTTPS');
  }
  const [run] = await db
    .select({ id: agentRun.id, projectId: agentRun.projectId })
    .from(agentRun)
    .where(
      and(eq(agentRun.id, runId), eq(agentRun.agentId, agentId), eq(agentRun.status, 'pending')),
    );
  if (!run) throw new HttpError(404, 'Active run not found');
  await assertMcpAllowed(run.projectId, headers);
  await saveRunOutputs(runId, [output], 'reported');
  return { ok: true };
}

export async function listRunOutputs(runId: number) {
  const rows = await db
    .select()
    .from(agentRunOutput)
    .where(eq(agentRunOutput.runId, runId))
    .orderBy(asc(agentRunOutput.id));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as OutputKind,
    title: row.title,
    target: row.target,
    source: row.source as OutputSource,
    createdAt: iso(row.createdAt),
  }));
}

export async function saveRunOutputs(
  runId: number,
  outputs: RunOutputInput[],
  source: OutputSource,
) {
  if (!outputs.length) return;
  const values = outputs.map((output) => ({ runId, ...output, source }));
  if (source === 'reported') {
    await db
      .insert(agentRunOutput)
      .values(values)
      .onConflictDoUpdate({
        target: [agentRunOutput.runId, agentRunOutput.kind, agentRunOutput.target],
        set: { title: values[0]!.title, source },
      });
  } else {
    await db.insert(agentRunOutput).values(values).onConflictDoNothing();
  }
}

export function inferredOutputs(events: unknown[]): RunOutputInput[] {
  const calls = new Map<string, { name: string; args: string }>();
  const outputs: RunOutputInput[] = [];
  const add = (kind: OutputKind, target: string) => {
    if (target.length > 2048 || !target.trim()) return;
    outputs.push({ kind, target, title: kind === 'file' ? target.split('/').at(-1)! : target });
  };
  for (const item of events) {
    if (!item || typeof item !== 'object') continue;
    const event = item as Record<string, unknown>;
    const id = typeof event.toolCallId === 'string' ? event.toolCallId : '';
    if (event.type === 'TOOL_CALL_START' && id && typeof event.toolCallName === 'string') {
      calls.set(id, { name: event.toolCallName.toLowerCase(), args: '' });
    }
    if (event.type === 'TOOL_CALL_ARGS' && id && typeof event.delta === 'string') {
      const call = calls.get(id);
      if (call && call.args.length < 16384) call.args += event.delta;
    }
    if (event.type !== 'TOOL_CALL_RESULT' || !id) continue;
    const call = calls.get(id);
    if (!call) continue;
    calls.delete(id);
    if (event.isError === true || (event.metadata as { isError?: boolean } | undefined)?.isError)
      continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.args) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (/(^|[._-])(write|edit|create_file|apply_patch)([._-]|$)/.test(call.name)) {
      const path = args.file_path ?? args.path;
      if (typeof path === 'string' && !path.includes('\n')) add('file', path);
      if (call.name.includes('apply_patch') && typeof args.patch === 'string') {
        for (const match of args.patch.matchAll(/^\*\*\* (?:Add|Update) File: (.+)$/gm)) {
          add('file', match[1]!);
        }
      }
    }
    const result =
      typeof event.content === 'string' ? event.content : JSON.stringify(event.content ?? '');
    if (
      /(create_pull_request|pull_request_create)/.test(call.name) ||
      /(?:gh\s+pr\s+create|pulls\.create)/.test(call.args)
    ) {
      for (const match of result.matchAll(/https:\/\/github\.com\/[^\s"'<>]+\/pull\/\d+/g)) {
        add('pr', match[0].replace(/[),.]+$/, ''));
      }
    }
    if (/(deploy|preview)/.test(call.name)) {
      const url = result.match(/https:\/\/[^\s"'<>]+/);
      if (url) add('preview', url[0].replace(/[),.]+$/, ''));
    }
  }
  return outputs;
}
