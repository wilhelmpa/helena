import { eq } from 'drizzle-orm';
import {
  db,
  aiAgent,
  listModelServers,
  getDisplayName,
  readModelServerKey,
  resolveLocalRoute,
  user,
  userPreference,
  type LocalRoute,
} from '@repo/db';
import {
  classEvalVersion,
  isLocalHalogenUrl,
  localThinkingFields,
  parseLocalModelId,
  priorityProxyBaseUrl,
  type LocalAiChatRequest,
} from '@helena/sdk';
import { joinUrl } from '#modules/local-ai/eval-context';
import { taskClass, effectiveModelNow } from '#modules/local-ai/service';
import {
  LOCAL_DEFAULT,
  localDefaultModel,
  readMaintenance,
} from '#modules/local-ai/maintenance-state';
import { runtimeOfPolicy } from '#modules/model-availability/service';
import {
  appendEvents,
  finishSpokenAnswer,
  registerSpokenAnswerer,
  releaseHeldAnswer,
  spokenConversation,
  takeHeldAnswer,
  type SpokenAnswerJob,
} from '#modules/agents/chat/service';
import type { AgUiEventBody } from '#modules/agents/chat/model';
import {
  VOICE_REPLY_CLASS,
  committed,
  isTextHandOver,
  parseStreamLine,
  voiceReplyNow,
  voiceReplyRequest,
  type StreamDelta,
} from './reply-request';
import { readVoiceSettings } from './settings';

// Native agents answer on their own local model; other runtimes use the evaluated voice class.
// The total cap also covers a model that began but then stalled.
const TOTAL_MS = 20_000;
// Written to the chat in steps like a runner's (packages/runner chat.ts).
const FLUSH_MS = 120;

async function route(agentId: number): Promise<LocalRoute | null> {
  if ((await readMaintenance())?.admissionPaused) return null;
  const [agent] = await db
    .select({ runtimePolicy: aiAgent.runtimePolicy, model: aiAgent.model })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  if (agent && runtimeOfPolicy(agent.runtimePolicy) === 'helena') {
    const modelId = await effectiveModelNow(
      agent.model === LOCAL_DEFAULT ? await localDefaultModel() : agent.model,
    );
    const parsed = parseLocalModelId(modelId);
    if (!parsed || !modelId) return null;
    const server = (await listModelServers()).find((entry) => entry.slug === parsed.slug);
    if (!server) return null;
    return { server, model: parsed.model, modelId, unit: 'gpu', mode: 'prefer' };
  }
  const entry = taskClass(VOICE_REPLY_CLASS);
  if (!entry) return null;
  const result = await resolveLocalRoute({
    classId: VOICE_REPLY_CLASS,
    unit: entry.unit,
    capability: entry.capability,
    evalVersion: classEvalVersion(entry),
  });
  return 'route' in result ? result.route : null;
}

// ── The stream of one answer ──────────────────────────────────────────────────────────────

type Outcome =
  | { kind: 'answered'; inputTokens: number | null; outputTokens: number | null }
  | { kind: 'hand-over' }
  | { kind: 'fallback' }
  | { kind: 'canceled' };

async function streamAnswer(
  job: SpokenAnswerJob,
  local: LocalRoute,
  request: LocalAiChatRequest,
  firstTokenMs: number,
): Promise<Outcome> {
  const key = await readModelServerKey(local.server);
  const abort = new AbortController();
  const total = setTimeout(() => abort.abort(), TOTAL_MS);
  const first = setTimeout(() => abort.abort(), firstTokenMs);
  const messageId = `msg-${job.messageId}`;
  let held = '';
  let open = false;
  let pending: AgUiEventBody[] = [];
  let flushing: Promise<void> = Promise.resolve();
  let canceled = false;
  let usage: StreamDelta['usage'] = null;

  const flush = () => {
    if (pending.length === 0) return flushing;
    const events = pending;
    pending = [];
    flushing = flushing.then(async () => {
      const ack = await appendEvents(job.agentId, job.messageId, events);
      if (!ack || ack.canceled) {
        canceled = true;
        abort.abort();
      }
    });
    return flushing;
  };
  const timer = setInterval(() => void flush(), FLUSH_MS);

  const say = (text: string) => {
    if (!text) return;
    const starting = !open;
    if (!open) {
      open = true;
      pending.push(
        { type: 'RUN_STARTED', runId: String(job.messageId), threadId: job.threadId },
        { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
      );
    }
    pending.push({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text });
    if (starting) void flush();
  };

  try {
    const response = await fetch(
      joinUrl(priorityProxyBaseUrl(local.server.baseUrl), '/chat/completions'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...(isLocalHalogenUrl(local.server.baseUrl)
            ? { 'x-volition-halogen-priority': 'voice-reply' }
            : {}),
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model: local.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
          tools: request.tools?.map((tool) => ({ type: 'function', function: tool })),
          tool_choice: 'auto',
          max_tokens: request.maxTokens,
          temperature: 0,
          stream: true,
          stream_options: { include_usage: true },
          reasoning_effort: 'none',
          ...localThinkingFields(request.thinking ?? 'off'),
        }),
        redirect: 'error',
        signal: abort.signal,
      },
    );
    if (!response.ok || !response.body) return { kind: 'fallback' };
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let firstSeen = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        const delta = parseStreamLine(line);
        if (delta === null) continue;
        if (delta === 'done') break;
        if (delta.usage) usage = delta.usage;
        if (!firstSeen && (delta.content || delta.toolCall)) {
          firstSeen = true;
          clearTimeout(first);
        }
        if (delta.toolCall && !open) return { kind: 'hand-over' };
        if (!delta.content) continue;
        if (open) {
          say(delta.content);
          continue;
        }
        held += delta.content;
        if (committed(held)) {
          say(held);
          held = '';
        }
      }
    }
    if (!open) {
      if (isTextHandOver(held)) return { kind: 'hand-over' };
      // Nothing but held-back text (a very short answer) or nothing at all.
      if (!held.trim()) return { kind: 'fallback' };
      say(held);
    }
    pending.push({ type: 'TEXT_MESSAGE_END', messageId });
    pending.push({ type: 'RUN_FINISHED', runId: String(job.messageId), threadId: job.threadId });
    await flush();
    if (canceled) return { kind: 'canceled' };
    return {
      kind: 'answered',
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
    };
  } catch {
    // Too slow to start, the server failed, or the owner stopped it.
    if (canceled) return { kind: 'canceled' };
    // Words already in the chat stay an answer (cut short); none, and the agent answers.
    if (open) {
      pending.push({ type: 'TEXT_MESSAGE_END', messageId });
      await flush().catch(() => {});
      return { kind: 'answered', inputTokens: null, outputTokens: null };
    }
    return { kind: 'fallback' };
  } finally {
    clearTimeout(total);
    clearTimeout(first);
    clearInterval(timer);
    await flushing.catch(() => {});
  }
}

// Who is speaking: the first name, the language the answer is in and the time zone "now" is
// told in (the person's preferences; German and Berlin where there are none).
async function person(
  userId: string,
): Promise<{ name: string | null; language: string; timeZone: string }> {
  const [row] = await db
    .select({ name: user.name, locale: userPreference.locale, timezone: userPreference.timezone })
    .from(user)
    .leftJoin(userPreference, eq(userPreference.userId, user.id))
    .where(eq(user.id, userId));
  const language = (row?.locale ?? 'de').slice(0, 2).toLowerCase();
  const timeZone = row?.timezone && row.timezone !== 'UTC' ? row.timezone : 'Europe/Berlin';
  return { name: row?.name?.split(/\s+/)[0] ?? null, language, timeZone };
}

export async function answerSpokenQuestion(job: SpokenAnswerJob): Promise<void> {
  const [local, settings] = await Promise.all([route(job.agentId), readVoiceSettings()]);
  if (!local || !(await takeHeldAnswer(job.agentId, job.messageId))) {
    await releaseHeldAnswer(job.agentId, job.messageId);
    return;
  }
  const [conversation, speaker] = await Promise.all([
    spokenConversation(job.threadId, job.messageId),
    person(job.userId),
  ]);
  const question = conversation.turns.at(-1);
  if (!question || question.role !== 'user') {
    await releaseHeldAnswer(job.agentId, job.messageId);
    return;
  }
  const request = voiceReplyRequest({
    agentName: conversation.agentName ?? (await getDisplayName()),
    displayName: await getDisplayName(),
    personName: speaker.name,
    now: voiceReplyNow(speaker.language, new Date(), speaker.timeZone),
    language: speaker.language,
    turns: conversation.turns.slice(0, -1),
    question: question.text,
  });
  // A cold Flash prefix can take a second before its first token.
  const firstTokenMs = isLocalHalogenUrl(local.server.baseUrl)
    ? Math.max(settings.fallbackTimeoutMs, 1_500)
    : settings.fallbackTimeoutMs;
  const outcome = await streamAnswer(job, local, request, firstTokenMs);
  if (outcome.kind === 'hand-over') {
    await releaseHeldAnswer(job.agentId, job.messageId);
    return;
  }
  if (outcome.kind === 'fallback') {
    await releaseHeldAnswer(job.agentId, job.messageId, {
      from: local.modelId,
      reason: 'failed',
    });
    return;
  }
  if (outcome.kind === 'canceled') return;
  await finishSpokenAnswer(job.agentId, job.messageId, {
    model: local.modelId,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
  });
}

registerSpokenAnswerer({
  async available(agentId) {
    const settings = await readVoiceSettings();
    return settings.immediateResponse && (await route(agentId)) !== null;
  },
  answer: (job) => answerSpokenQuestion(job),
});
