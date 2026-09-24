import { AnswerStream } from './agui';
import type { ChatMessage, Client } from './client';
import { presetOf, type RunnerConfig } from './config';
import { execute } from './execute';
import { LoginUseReader } from './logins';
import type { HermesRunSettings } from './policy';
import { withInstructions } from './run';
import { runModelReport, type RuntimeAdapter } from './runtime';

// The command is the same one that handles a queued run; what differs is that its output
// is reported while it is still being written, so the person waiting in the chat reads the
// answer as it appears.
//
// A thread with no session yet is answered by a command started without one, and the
// session it reports is sent with the first batch of events after it is named, which
// binds the thread.
//
// `stop` is aborted when the server says the member stopped the answer — on the events
// report while the command is writing, on the heartbeat while it is silent. The server
// has already closed the answer by then, so the command is killed and nothing more is
// reported for it.

// Often enough to read as typing, rarely enough that a chatty command does not become a
// request per line. 150 ms (was 500, owner 2026-09-24: "richtig starker Chat mit
// Stream"): with the API following at 100 ms an answer arrives in steps of about a
// quarter second instead of up to 0.8 s.
const FLUSH_MS = 150;

export async function answer(
  config: RunnerConfig,
  client: Client,
  message: ChatMessage,
  stop: AbortController,
  hermes: HermesRunSettings | null,
  runtimeAdapter: RuntimeAdapter | null = null,
): Promise<void> {
  // Reported once: repeating it on every batch is a field the server has to ignore.
  let reported = message.sessionId !== null;
  const stream: AnswerStream = new AnswerStream(
    config.outputFormat,
    message.threadId,
    String(message.id),
    async (events) => {
      const started = reported ? undefined : (stream.startedSession() ?? undefined);
      if (started) reported = true;
      if (await client.chatEvents(message.id, events, started)) stop.abort();
    },
  );
  // A flush that fails is not fatal: the next one carries what it left behind.
  const flushing = setInterval(() => {
    void stream.flush().catch(() => {});
  }, FLUSH_MS);
  const logins = new LoginUseReader(hermes?.logins ?? new Map());
  const outcome = await execute(
    { ...config, args: [...config.args, ...(hermes?.args ?? [])] },
    {
      prompt: message.prompt,
      systemPrompt: withInstructions(hermes?.instructions, message.systemPrompt, message.sessionId),
      sessionId: message.sessionId,
      model: message.model,
      thinkingLevel: message.thinkingLevel,
      toolsets: hermes?.toolsets ?? null,
      image: message.images?.[0] ?? null,
      env: {
        ITSAPLAN_TRIGGER: 'chat',
        // No run: the header Helena's MCP server gets it in stays empty.
        ITSAPLAN_RUN_ID: '',
        ITSAPLAN_SYSTEM_PROMPT: message.systemPrompt,
        ITSAPLAN_THREAD_ID: message.threadId,
        ITSAPLAN_MESSAGE_ID: String(message.id),
        ITSAPLAN_SESSION_ID: message.sessionId ?? '',
        ...hermes?.env,
      },
    },
    {
      onData: (chunk) => {
        stream.write(chunk);
        logins.write(chunk);
      },
      signal: stop.signal,
      work: { kind: 'chat', id: message.id },
    },
  ).finally(() => clearInterval(flushing));
  if (stop.signal.aborted) return;
  const uses = logins.uses();
  if (uses.length > 0) {
    await client.reportLoginUses({ messageId: message.id }, uses).catch(() => {});
  }
  const runtime = await runModelReport(
    runtimeAdapter,
    { model: message.model, reasoning: message.thinkingLevel },
    outcome.sessionId ?? stream.startedSession() ?? message.sessionId ?? undefined,
    stream.model(),
  );
  // The context size is read after the stream is closed, which is where the last line of
  // the output is parsed. An answer that failed reports it too: what the command read
  // before it broke is still the size of its session's context.
  if (outcome.status === 'success') {
    await stream.finish(outcome.output);
    await client.chatResult(message.id, {
      status: 'success',
      usage: stream.contextUsage(),
      ...(stream.model() && { model: stream.model()! }),
      ...(runtime && { runtime }),
    });
    return;
  }
  const error = outcome.error ?? 'The command failed';
  // The server unbinds the session and queues the answer again, with the conversation
  // framed into its prompt, so the person sees no failure for it.
  if (message.sessionId !== null && presetOf(config)?.sessionLost?.(error)) {
    await client.chatResult(message.id, { status: 'failed', error, sessionLost: true });
    return;
  }
  await stream.fail(error, outcome.output);
  await client.chatResult(message.id, {
    status: 'failed',
    error,
    usage: stream.contextUsage(),
    ...(stream.model() && { model: stream.model()! }),
    ...(runtime && { runtime }),
  });
}
