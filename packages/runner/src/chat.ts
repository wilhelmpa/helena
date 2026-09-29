import { AnswerStream } from './agui';
import type { ChatMessage, Client } from './client';
import { presetOf, type RunnerConfig } from './config';
import { execute, modelProvider } from './execute';
import { LoginUseReader } from './logins';
import type { HermesRunSettings } from './policy';
import { SpendReader } from './spend';
import { EscalationReader } from './agui';
import { observeLimits } from './limits/context';
import { reportUntilTaken, runRedactor, withInstructions } from './run';
import { runModelReport, type RuntimeAdapter } from './runtime';
import { SecretMask } from '@helena/sdk';

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
  let offset = 0;
  // The values handed to the command (the agent's key, its MCP secrets, the variables
  // delivered for this answer) never reach the chat.
  const mask = new SecretMask(
    runRedactor(config, hermes?.env ?? {}, hermes?.delivered?.secrets).secrets(),
  );
  const stream: AnswerStream = new AnswerStream(
    config.outputFormat,
    message.threadId,
    String(message.id),
    async (events) => {
      const started = reported ? undefined : (stream.startedSession() ?? undefined);
      await reportUntilTaken(async () => {
        stop.signal.throwIfAborted();
        if (
          await client.chatEvents(
            message.id,
            events,
            started,
            message.attempts === undefined ? undefined : { claim: message.attempts, offset },
          )
        )
          stop.abort();
      }, stop.signal);
      if (stop.signal.aborted) return;
      if (started) reported = true;
      offset += events.length;
    },
    mask,
    200,
  );
  // Reporting waits through a short API outage while the command keeps running.
  const flushing = setInterval(() => {
    void stream.flush().catch(() => {});
  }, FLUSH_MS);
  const logins = new LoginUseReader(hermes?.logins ?? new Map());
  const limits = observeLimits(config, runtimeAdapter ?? null, client);
  const spend = new SpendReader(
    config.outputFormat,
    config.command ? null : (config.agent ?? null),
  );
  const escalation = new EscalationReader(config.outputFormat);
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
      autopilotLevel: message.autopilotLevel ?? null,
      env: {
        ITSAPLAN_TRIGGER: 'chat',
        ITSAPLAN_PROJECT_ID: String(message.projectId ?? ''),
        // No run: the header Helena's MCP server gets it in stays empty.
        ITSAPLAN_RUN_ID: '',
        ITSAPLAN_SYSTEM_PROMPT: message.systemPrompt,
        ITSAPLAN_THREAD_ID: message.threadId,
        ITSAPLAN_MESSAGE_ID: String(message.id),
        ITSAPLAN_SESSION_ID: message.sessionId ?? '',
        ...hermes?.env,
        VOLITION_HALOGEN_PRIORITY: 'interactive',
      },
      hooks: hermes?.hooks,
      delivered: hermes?.delivered?.names,
      ...(hermes?.input && { input: hermes.input }),
    },
    {
      onData: (chunk) => {
        stream.write(chunk);
        spend.write(chunk);
        escalation.write(chunk);
        logins.write(chunk);
        limits?.write(chunk);
      },
      signal: stop.signal,
      work: { kind: 'chat', id: message.id },
    },
  ).finally(() => clearInterval(flushing));
  await limits?.end();
  if (stop.signal.aborted) return;
  const spent =
    outcome.spend ??
    spend.value({
      model: message.model,
      provider: modelProvider(config, message.model, message.thinkingLevel) ?? null,
    });
  const uses = logins.uses();
  if (uses.length > 0) {
    await client.reportLoginUses({ messageId: message.id }, uses).catch(() => {});
  }
  const runtime = await runModelReport(
    runtimeAdapter,
    {
      model: message.model,
      reasoning: message.thinkingLevel,
      provider: modelProvider(config, message.model, message.thinkingLevel) ?? null,
    },
    outcome.sessionId ?? stream.startedSession() ?? message.sessionId ?? undefined,
    stream.model(),
  );
  const report = (result: Parameters<Client['chatResult']>[1]) =>
    reportUntilTaken(async () => {
      stop.signal.throwIfAborted();
      await client.chatResult(message.id, result, message.attempts);
    }, stop.signal);
  // The context size is read after the stream is closed, which is where the last line of
  // the output is parsed. An answer that failed reports it too: what the command read
  // before it broke is still the size of its session's context.
  const handedOver = escalation.value();
  if (outcome.status === 'success' || (handedOver && outcome.status === 'failed')) {
    await stream.finish(outcome.output);
    await report({
      status: 'success',
      ...(handedOver && {
        escalation: { ...handedOver, handover: mask.text(handedOver.handover) },
      }),
      usage: outcome.usage ?? stream.contextUsage(),
      spend: spent,
      ...(stream.model() && { model: stream.model()! }),
      ...(runtime && { runtime }),
    });
    return;
  }
  const error = mask.text(outcome.error ?? 'The command failed');
  // The server unbinds the session and queues the answer again, with the conversation
  // framed into its prompt, so the person sees no failure for it.
  if (message.sessionId !== null && presetOf(config)?.sessionLost?.(error)) {
    await report({
      status: 'failed',
      error,
      sessionLost: true,
      spend: spent,
    });
    return;
  }
  // The code lets the chat word a known failure in the reader's language.
  await stream.fail(error, outcome.output, outcome.failure?.code);
  await report({
    status: 'failed',
    error,
    usage: outcome.usage ?? stream.contextUsage(),
    spend: spent,
    ...(stream.model() && { model: stream.model()! }),
    ...(runtime && { runtime }),
    ...(outcome.failure && { failure: outcome.failure }),
  });
}
