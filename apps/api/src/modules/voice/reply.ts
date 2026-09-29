import { eq } from 'drizzle-orm';
import {
  db,
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
  priorityProxyBaseUrl,
  type LocalAiChatRequest,
} from '@helena/sdk';
import { joinUrl } from '#modules/local-ai/eval-context';
import { taskClass } from '#modules/local-ai/service';
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
  parseStreamLine,
  voiceReplyNow,
  voiceReplyRequest,
  type StreamDelta,
} from './reply-request';
import { readVoiceSettings } from './settings';

// Helena's voice reply (Lokale KI → "Sprachantwort", class `voice-reply`;
// docs/helena-decisions/voice-2.md §4). A spoken question goes to the agent like a typed one,
// and an agent's turn takes seconds before its first word (the runner starts its runtime, the
// model reads the session: 5 s measured on 2026-09-26). In a conversation that is a long
// silence. So a small, fast local model hears the question first:
//
// - what the conversation and general knowledge answer (a greeting, "hörst du mich?", thanks,
//   "sag das kürzer", the time, a general question) it answers itself, in a sentence or two,
//   within a fraction of a second, streamed into the chat like any answer;
// - everything that needs the agent — its tools, the owner's data, doing something — it hands
//   on at once (the tool `hand_to_agent`), and the agent's runner answers as it always does.
//
// It never acts and never sees anything but the conversation: no tools but the hand-over, no
// Helena data. Its answer is marked (`via = 'voice'`) and names its model. Off by default; like
// every local class it can only be switched on once its eval (reply-eval.ts) passed.

// The total cap also covers a model that began but then stalled.
const TOTAL_MS = 20_000;
// Written to the chat in steps like a runner's (packages/runner chat.ts).
const FLUSH_MS = 120;

async function route(): Promise<LocalRoute | null> {
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
            ? { 'x-volition-halogen-priority': 'interactive' }
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
          temperature: 0.3,
          stream: true,
          stream_options: { include_usage: true },
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
  const [local, settings] = await Promise.all([route(), readVoiceSettings()]);
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
    agentName: conversation.agentName ?? 'Helena',
    personName: speaker.name,
    now: voiceReplyNow(speaker.language, new Date(), speaker.timeZone),
    language: speaker.language,
    turns: conversation.turns.slice(0, -1),
    question: question.text,
  });
  const outcome = await streamAnswer(job, local, request, settings.fallbackTimeoutMs);
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
  async available() {
    const settings = await readVoiceSettings();
    return settings.immediateResponse && (await route()) !== null;
  },
  answer: (job) => answerSpokenQuestion(job),
});
