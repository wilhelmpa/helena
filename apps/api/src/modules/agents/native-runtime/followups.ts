import type { MessageInjectedEventBody } from './model';
import { ownerOrigin } from '#modules/root-access/provenance';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  db,
  aiAgent,
  agentRun,
  agentRunEvent,
  agentChatMessage,
  agentChatThread,
  agentChatEvent,
  helenaAgentSession,
  helenaAgentSessionItem,
  volitionFollowup,
} from '@repo/db';
import { HttpError } from '#shared/lib';
import { runtimeOfPolicy } from '#modules/model-availability/service';
import { normalizeRuntimePolicy } from '../core/service';

export type FollowupMode = 'inject' | 'after' | 'replace';
export type FollowupTarget = { kind: 'chat' | 'run'; id: number };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Instruction = typeof volitionFollowup.$inferSelect;
const pending = (target: FollowupTarget) =>
  and(
    eq(volitionFollowup.waitId, target.id),
    target.kind === 'chat'
      ? sql`${volitionFollowup.messageId} IS NOT NULL`
      : sql`${volitionFollowup.runId} IS NOT NULL`,
    eq(volitionFollowup.state, 'pending'),
  );

async function targetRow(tx: Tx, target: FollowupTarget, agentId: number) {
  if (target.kind === 'chat') {
    const [row] = await tx
      .select()
      .from(agentChatMessage)
      .where(
        and(
          eq(agentChatMessage.id, target.id),
          eq(agentChatMessage.agentId, agentId),
          eq(agentChatMessage.role, 'assistant'),
        ),
      )
      .for('no key update');
    if (!row) throw new HttpError(404, 'Answer not found');
    const [thread] = await tx
      .select()
      .from(agentChatThread)
      .where(eq(agentChatThread.id, row.threadId));
    return {
      ...row,
      kind: 'chat' as const,
      claim: row.attempts,
      projectId: thread!.projectId,
      userId: thread!.userId,
    };
  }
  const [row] = await tx
    .select()
    .from(agentRun)
    .where(and(eq(agentRun.id, target.id), eq(agentRun.agentId, agentId)))
    .for('no key update');
  if (!row) throw new HttpError(404, 'Run not found');
  return { ...row, kind: 'run' as const, claim: row.claims, userId: null };
}
type TargetRow = Awaited<ReturnType<typeof targetRow>>;
const live = (row: TargetRow) => ['pending', 'streaming'].includes(row.status);
async function modes(tx: Tx, row: TargetRow): Promise<FollowupMode[]> {
  const [agent] = await tx
    .select({ policy: aiAgent.runtimePolicy })
    .from(aiAgent)
    .where(eq(aiAgent.id, row.agentId));
  const runtime = row.observedRuntime ?? runtimeOfPolicy(normalizeRuntimePolicy(agent!.policy));
  return runtime === 'helena' ? ['inject', 'after', 'replace'] : ['after'];
}
async function event(
  tx: Tx,
  row: TargetRow,
  instruction: Instruction,
  position?: { sessionId: string; seq: number; step: number },
) {
  const payload = {
    type: 'CUSTOM',
    name: 'message_injected',
    value: {
      id: instruction.id,
      mode: instruction.mode,
      state: instruction.state,
      prompt: instruction.prompt,
      nextId: instruction.nextId,
      ...(position && { position }),
    },
  };
  if (row.kind === 'chat') await tx.insert(agentChatEvent).values({ messageId: row.id, payload });
  else await tx.insert(agentRunEvent).values({ runId: row.id, claim: row.claim, payload });
}

export async function readFollowups(
  target: FollowupTarget,
  agentId: number,
  userId: string,
  projectId: number | null,
) {
  return db.transaction(async (tx) => {
    const row = await targetRow(tx, target, agentId);
    if (row.projectId !== projectId || (row.kind === 'chat' && row.userId !== userId))
      throw new HttpError(404, 'Work not found');
    const items = await tx
      .select()
      .from(volitionFollowup)
      .where(
        target.kind === 'chat'
          ? eq(volitionFollowup.messageId, target.id)
          : eq(volitionFollowup.runId, target.id),
      )
      .orderBy(asc(volitionFollowup.createdAt), asc(volitionFollowup.id));
    const table = target.kind === 'chat' ? agentChatEvent : agentRunEvent;
    const targetId = target.kind === 'chat' ? agentChatEvent.messageId : agentRunEvent.runId;
    const events = await tx
      .select({ payload: table.payload })
      .from(table)
      .where(
        and(
          eq(targetId, target.id),
          sql`${table.payload}->>'name' = 'message_injected'`,
          sql`${table.payload}->'value'->>'state' = 'applied'`,
        ),
      );
    const positions = new Map(
      events.map((event) => {
        const value = (event.payload as MessageInjectedEventBody).value;
        return [value.id, value.position];
      }),
    );
    return {
      modes: await modes(tx, row),
      items: items.map((item) => ({ ...dto(item), position: positions.get(item.id) })),
    };
  });
}
const dto = (item: Instruction) => ({
  id: item.id,
  mode: item.mode,
  state: item.state,
  prompt: item.prompt,
  nextId: item.nextId,
});

export async function submitFollowup(
  target: FollowupTarget,
  agentId: number,
  userId: string,
  projectId: number | null,
  input: { id: string; mode: FollowupMode; prompt: string },
) {
  return db.transaction(async (tx) => {
    const row = await targetRow(tx, target, agentId);
    if (row.projectId !== projectId || (row.kind === 'chat' && row.userId !== userId))
      throw new HttpError(404, 'Work not found');
    const available = await modes(tx, row);
    if (!available.includes(input.mode))
      throw new HttpError(409, 'This runtime only supports after');
    const [existing] = await tx
      .select()
      .from(volitionFollowup)
      .where(eq(volitionFollowup.id, input.id));
    if (existing) {
      if (
        existing.agentId !== agentId ||
        existing.userId !== userId ||
        existing.messageId !== (target.kind === 'chat' ? target.id : null) ||
        existing.runId !== (target.kind === 'run' ? target.id : null) ||
        existing.mode !== input.mode ||
        existing.prompt !== input.prompt
      )
        throw new HttpError(409, 'Instruction ID already used');
      return dto(existing);
    }
    let waiting = row;
    while (!live(waiting)) {
      const [successor] = await tx
        .select({ nextId: volitionFollowup.nextId })
        .from(volitionFollowup)
        .where(
          and(
            eq(volitionFollowup.agentId, agentId),
            eq(volitionFollowup.waitId, waiting.id),
            eq(volitionFollowup.state, 'queued'),
            target.kind === 'chat'
              ? sql`${volitionFollowup.messageId} IS NOT NULL`
              : sql`${volitionFollowup.runId} IS NOT NULL`,
          ),
        )
        .limit(1);
      if (!successor?.nextId) break;
      waiting = await targetRow(tx, { ...target, id: successor.nextId }, agentId);
    }
    const origin = await ownerOrigin(agentId, userId);
    if (
      input.mode !== 'after' &&
      live(row) &&
      row.rootOrigin === 'owner-direct' &&
      origin !== 'owner-direct'
    ) {
      if (row.kind === 'chat')
        await tx
          .update(agentChatMessage)
          .set({ rootOrigin: 'system' })
          .where(eq(agentChatMessage.id, row.id));
      else await tx.update(agentRun).set({ rootOrigin: 'system' }).where(eq(agentRun.id, row.id));
    }
    const queued = await tx
      .select({ id: volitionFollowup.id })
      .from(volitionFollowup)
      .where(pending({ ...target, id: waiting.id }))
      .limit(32);
    if (queued.length >= 32) throw new HttpError(429, 'Too many pending instructions');
    const [instruction] = await tx
      .insert(volitionFollowup)
      .values({
        ...input,
        waitId: waiting.id,
        userId,
        agentId,
        messageId: target.kind === 'chat' ? target.id : null,
        runId: target.kind === 'run' ? target.id : null,
      })
      .returning();
    await event(tx, row, instruction!);
    if (!live(waiting)) await dispatch(tx, waiting, { ...target, id: waiting.id });
    const [saved] = await tx
      .select()
      .from(volitionFollowup)
      .where(eq(volitionFollowup.id, input.id));
    return dto(saved!);
  });
}

async function dispatch(tx: Tx, row: TargetRow, target: FollowupTarget) {
  const items = await tx
    .select()
    .from(volitionFollowup)
    .where(pending(target))
    .orderBy(asc(volitionFollowup.createdAt), asc(volitionFollowup.id));
  if (!items.length) return;
  // One successor at a time; the remaining instructions follow that successor.
  const [item, ...rest] = items;
  let nextId: number;
  if (row.kind === 'chat') {
    const [thread] = await tx
      .select()
      .from(agentChatThread)
      .where(eq(agentChatThread.id, row.threadId))
      .for('update');
    if (!thread || thread.deletedAt) return;
    const [active] = await tx
      .select({ id: agentChatMessage.id })
      .from(agentChatMessage)
      .where(
        and(
          eq(agentChatMessage.threadId, row.threadId),
          inArray(agentChatMessage.status, ['pending', 'streaming']),
        ),
      )
      .limit(1);
    if (active) return;
    const [question] = await tx
      .insert(agentChatMessage)
      .values({
        threadId: row.threadId,
        agentId: row.agentId,
        parentId: thread.activeMessageId ?? row.id,
        role: 'user',
        content: item!.prompt,
        status: 'success',
      })
      .returning({ id: agentChatMessage.id });
    const [answer] = await tx
      .insert(agentChatMessage)
      .values({
        threadId: row.threadId,
        agentId: row.agentId,
        parentId: question!.id,
        role: 'assistant',
        rootOrigin: await ownerOrigin(row.agentId, item!.userId),
        taintSources: row.taintSources,
      })
      .returning({ id: agentChatMessage.id });
    nextId = answer!.id;
    await tx
      .update(agentChatThread)
      .set({ activeMessageId: nextId, updatedAt: new Date() })
      .where(eq(agentChatThread.id, row.threadId));
  } else {
    const [next] = await tx
      .insert(agentRun)
      .values({
        agentId: row.agentId,
        projectId: row.projectId,
        issueId: row.issueId,
        trigger: 'manual',
        prompt: item!.prompt,
        model: row.model,
        reasoning: row.reasoning,
        sessionId: row.sessionId,
        continuedFromRunId: row.id,
        rootOrigin: await ownerOrigin(row.agentId, item!.userId),
        taintSources: row.taintSources,
      })
      .returning({ id: agentRun.id });
    nextId = next!.id;
  }
  const [updated] = await tx
    .update(volitionFollowup)
    .set({ state: 'queued', nextId })
    .where(eq(volitionFollowup.id, item!.id))
    .returning();
  await event(tx, row, updated!);
  if (rest.length)
    await tx
      .update(volitionFollowup)
      .set({ waitId: nextId })
      .where(
        inArray(
          volitionFollowup.id,
          rest.map((i) => i.id),
        ),
      );
}

export async function dispatchFollowups(agentId: number) {
  const targets = await db
    .selectDistinct({
      messageId: volitionFollowup.messageId,
      runId: volitionFollowup.runId,
      waitId: volitionFollowup.waitId,
    })
    .from(volitionFollowup)
    .where(and(eq(volitionFollowup.agentId, agentId), eq(volitionFollowup.state, 'pending')));
  for (const target of targets)
    await db.transaction(async (tx) => {
      const ref: FollowupTarget =
        target.messageId !== null
          ? { kind: 'chat', id: target.waitId }
          : { kind: 'run', id: target.waitId };
      const row = await targetRow(tx, ref, agentId);
      if (!live(row)) await dispatch(tx, row, ref);
    });
}

export async function nativeFollowups(
  agentId: number,
  input: FollowupTarget & { claim: number; sessionId?: string; afterSeq?: number; step?: number },
) {
  return db.transaction(async (tx) => {
    const row = await targetRow(tx, input, agentId);
    if (!live(row) || row.claim !== input.claim || row.observedRuntime !== 'helena')
      throw new HttpError(409, 'Work claim is no longer active');
    const items = await tx
      .select()
      .from(volitionFollowup)
      .where(
        and(
          pending(input),
          input.kind === 'chat'
            ? eq(volitionFollowup.messageId, input.id)
            : eq(volitionFollowup.runId, input.id),
          inArray(volitionFollowup.mode, ['inject', 'replace']),
        ),
      )
      .orderBy(asc(volitionFollowup.createdAt), asc(volitionFollowup.id));
    if (!input.sessionId)
      return {
        pending: items.length > 0,
        replace: items.some((i) => i.mode === 'replace'),
        items: [],
      };
    if (input.afterSeq === undefined || input.step === undefined)
      throw new HttpError(400, 'A boundary needs sequence and step');
    const [session] = await tx
      .select()
      .from(helenaAgentSession)
      .where(
        and(eq(helenaAgentSession.id, input.sessionId), eq(helenaAgentSession.agentId, agentId)),
      )
      .for('update');
    if (
      !session ||
      (row.kind === 'chat'
        ? session.chatThreadId !== row.threadId
        : session.runId !== row.id && session.id !== row.sessionId)
    )
      throw new HttpError(404, 'Session not found');
    if (row.sessionId && row.sessionId !== session.id)
      throw new HttpError(409, 'Work session changed');
    if (!row.sessionId) {
      if (row.kind === 'chat')
        await tx
          .update(agentChatMessage)
          .set({ sessionId: session.id })
          .where(eq(agentChatMessage.id, row.id));
      else await tx.update(agentRun).set({ sessionId: session.id }).where(eq(agentRun.id, row.id));
    }
    const [last] = await tx
      .select({ seq: helenaAgentSessionItem.seq })
      .from(helenaAgentSessionItem)
      .where(eq(helenaAgentSessionItem.sessionId, session.id))
      .orderBy(sql`${helenaAgentSessionItem.seq} DESC`)
      .limit(1);
    if ((last?.seq ?? 0) !== input.afterSeq)
      throw new HttpError(409, 'Session sequence changed; reload before continuing');
    const messages = items.map((item, index) => ({
      seq: input.afterSeq! + index + 1,
      step: input.step!,
      message: {
        role: 'user' as const,
        content:
          item.mode === 'replace'
            ? `The previous turn was stopped. Replace its remaining instructions with this request:\n\n${item.prompt}`
            : item.prompt,
      },
    }));
    if (messages.length) {
      await tx.insert(helenaAgentSessionItem).values(
        messages.map((item) => ({
          sessionId: session.id,
          seq: item.seq,
          step: item.step,
          role: 'user',
          content: item.message,
          text: item.message.content,
        })),
      );
      await tx
        .update(helenaAgentSession)
        .set({ updatedAt: new Date() })
        .where(eq(helenaAgentSession.id, session.id));
      for (const [index, item] of items.entries()) {
        const [updated] = await tx
          .update(volitionFollowup)
          .set({ state: 'applied' })
          .where(eq(volitionFollowup.id, item.id))
          .returning();
        await event(tx, row, updated!, {
          sessionId: session.id,
          seq: messages[index]!.seq,
          step: input.step!,
        });
      }
    }
    return {
      pending: items.length > 0,
      replace: items.some((i) => i.mode === 'replace'),
      items: messages,
    };
  });
}
