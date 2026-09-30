import type { TurnInstructions } from './followups';
import { generateText, jsonSchema, streamText, tool, type ModelMessage, type ToolSet } from 'ai';
import { DEFAULTS, type AgentRuntimeConfig } from './config';
import {
  escalationTarget,
  centralEscalation,
  FailureWatch,
  isRuntimeTarget,
  preflightEscalation,
  type Escalation,
} from './escalation';
import type { EventSink, ResultEvent, SpendEvent } from './events';
import type { Decision } from './helena-client';
import { providerOptionsKey, type ResolvedModel } from './models';
import { LocalModelBusy, LocalQueueRetry, type QueueAttempt } from './local-queue';
import { messageText, type SessionItem, type SessionStore } from './session';
import { looksSecret, redactSecrets } from '@helena/facts';
import type { AgentTool, PolicyQuestion, ToolOutput } from './tools/types';

// Helena's agent loop. One model call per step through the AI SDK (streaming, the tools
// given without `execute`), then Helena runs the calls of that step itself: the policy
// engine first, each call with its own deadline, the browser tools within one shared
// budget. After every step the new messages are saved (so a command started again resumes
// the session), the context is compressed when it grows too big, and the loop checks its
// limits and the signs of a run going nowhere (docs/helena-decisions/zentrale-laufzeit.md §5).

export interface LoopInput {
  followups?: TurnInstructions;
  config: AgentRuntimeConfig;
  prompt: string;
  system: string;
  sessionId: string | null;
  labels?: string[];
  models: ResolvedModel[];
  // The model a hand-over switches to when the escalation target is one this loop drives.
  escalationModel?: ResolvedModel | null;
  resolveEscalationModel?: (target: string) => ResolvedModel | null;
  // Every tool the agent may use; `direct` names the ones the model sees from the start.
  tools: AgentTool[];
  direct: Set<string>;
  sessions: SessionStore;
  sink: EventSink;
  policy: (question: PolicyQuestion) => Promise<Decision>;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
  // Called once before the first step: the decision service's view of the task.
  uncertainty?: () => Promise<Escalation | null>;
  selectTools?: (input: { prompt: string; tools: AgentTool[] }) => Promise<string[] | null>;
  // A durable note for the agent's memory (the flush before a compression).
  note?: (text: string) => Promise<void>;
  // The caller writes the closing spend and result lines itself (after a reflection).
  deferFinal?: boolean;
  now?: () => number;
}

export interface LoopResult {
  status: 'success' | 'failed' | 'escalated' | 'waiting';
  text: string;
  exitCode: number;
  reason?: string;
  // The words the runner reads a failure by ("Session not found").
  error?: string;
  sessionId: string;
  steps: number;
  // What the command spent; emitted already, unless the caller deferred the closing lines.
  spend: SpendEvent;
  // The verdict of the last test run of the command (null: none ran), and the tools it called.
  testsGreen: boolean | null;
  toolsUsed: string[];
}

class StepAbort extends Error {
  constructor(
    readonly why: 'first-chunk' | 'chunk' | 'step-timeout' | 'budget' | 'aborted' | 'model-busy',
  ) {
    super(why);
  }
}

// Provider errors after which the same step goes to the next model of the chain.
function isProviderFailure(error: unknown): boolean {
  if (error instanceof LocalModelBusy) return true;
  if (error instanceof StepAbort)
    return ['first-chunk', 'chunk', 'step-timeout'].includes(error.why);
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|socket|5\d\d|overloaded|unavailable|APICallError|RetryError|timed? ?out/i.test(
    text,
  );
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 400);
}

// Old tool results shrink in the prompt (not in the session): the model has read them.
function shrinkOld(entries: SessionItem[], currentStep: number): ModelMessage[] {
  return entries.map((entry) => {
    const message = entry.message;
    if (message.role !== 'tool' || entry.step >= currentStep - 3) return message;
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== 'tool-result') return part;
        const output = part.output;
        if (
          (output.type === 'text' || output.type === 'error-text') &&
          output.value.length > 2000
        ) {
          return {
            ...part,
            output: { ...output, value: `${output.value.slice(0, 2000)}\n… (gekürzt)` },
          };
        }
        return part;
      }),
    };
  });
}

export async function runLoop(input: LoopInput): Promise<LoopResult> {
  const { config, sink, sessions } = input;
  const now = input.now ?? Date.now;
  const started = now();
  let budgetStarted = started;
  const kind = config.kind ?? 'run';
  const budgetMs =
    (config.limits?.runBudgetSeconds ??
      (kind === 'chat' ? DEFAULTS.chatBudgetSeconds : DEFAULTS.runBudgetSeconds)) * 1000;
  const queueRetry = new LocalQueueRetry(
    (config.limits?.localModelQueueSeconds ??
      (kind === 'chat' ? DEFAULTS.chatModelQueueSeconds : DEFAULTS.localModelQueueSeconds)) * 1000,
    sink,
  );
  const maxTurns = config.limits?.maxTurns ?? DEFAULTS.maxTurns;
  const firstChunkMs = (config.limits?.firstChunkSeconds ?? DEFAULTS.firstChunkSeconds) * 1000;
  const stepMs = (config.limits?.stepSeconds ?? DEFAULTS.stepSeconds) * 1000;
  const chunkMs = (config.limits?.chunkSeconds ?? DEFAULTS.chunkSeconds) * 1000;
  const toolTimeoutMs = (config.tools?.toolTimeoutSeconds ?? DEFAULTS.toolTimeoutSeconds) * 1000;
  let browserLeftMs = (config.tools?.browserBudgetSeconds ?? DEFAULTS.browserBudgetSeconds) * 1000;
  const toolsByName = new Map(input.tools.map((entry) => [entry.name, entry]));
  const active = new Set([...input.direct].filter((name) => toolsByName.has(name)));
  const discovered = new Set<string>();
  let chain = [...input.models];
  if (chain.length === 0) throw new Error('no model to run on');

  // ── the session ──
  let sessionId = input.sessionId;
  let entries: SessionItem[] = [];
  let summary: string | null = null;
  let compactedThrough = 0;
  if (sessionId) {
    const stored = await sessions.load(sessionId);
    if (!stored) {
      const lost = {
        status: 'failed' as const,
        text: '',
        exitCode: 1,
        reason: 'error',
        error: 'Session not found',
      };
      if (!input.deferFinal) sink.emit(resultEvent(lost));
      return {
        status: 'failed',
        text: '',
        exitCode: 1,
        reason: 'error',
        error: 'Session not found',
        sessionId,
        steps: 0,
        spend: {
          type: 'spend',
          model: null,
          provider: null,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          durationMs: 0,
          steps: 0,
          toolCalls: 0,
        },
        testsGreen: null,
        toolsUsed: [],
      };
    }
    entries = stored.items;
    summary = stored.summary;
    compactedThrough = stored.compactedThrough;
  } else {
    sessionId = await sessions.create({
      kind,
      model: chain[0]!.id,
      runId: Number(input.env.ITSAPLAN_RUN_ID) || null,
      threadId: input.env.ITSAPLAN_THREAD_ID || null,
    });
  }
  sink.emit({ type: 'session', id: sessionId });
  sink.emit({ type: 'model', id: chain[0]!.id });
  let seq = entries.reduce((max, entry) => Math.max(max, entry.seq), 0);
  let step = entries.reduce((max, entry) => Math.max(max, entry.step), 0);
  const firstStep = step + 1;
  const save = async (messages: ModelMessage[], atStep: number) => {
    const items = messages.map((message) => ({ seq: ++seq, step: atStep, message }));
    entries.push(...items);
    await sessions.append(sessionId!, items);
  };
  let workId: string | null = null;
  if (input.env.ITSAPLAN_MESSAGE_ID) workId = `chat:${input.env.ITSAPLAN_MESSAGE_ID}`;
  else if (input.env.ITSAPLAN_RUN_ID) workId = `run:${input.env.ITSAPLAN_RUN_ID}`;
  const alreadyStarted =
    workId &&
    entries.some(
      (entry) =>
        entry.message.role === 'user' && entry.message.providerOptions?.volition?.workId === workId,
    );
  if (!alreadyStarted)
    await save(
      [
        {
          role: 'user',
          content: input.prompt,
          ...(workId && { providerOptions: { volition: { workId } } }),
        },
      ],
      firstStep,
    );

  // ── spend, summed over the steps ──
  const spend: SpendEvent = {
    type: 'spend',
    model: chain[0]!.id,
    provider: chain[0]!.provider,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    durationMs: 0,
    steps: 0,
    toolCalls: 0,
  };
  const toolsUsed = new Set<string>();
  let watch: FailureWatch | null = null;
  const finish = (
    result: Omit<LoopResult, 'sessionId' | 'steps' | 'spend' | 'testsGreen' | 'toolsUsed'>,
  ): LoopResult => {
    spend.durationMs = now() - started;
    if (!input.deferFinal) {
      sink.emit(spend);
      sink.emit(resultEvent(result));
    }
    return {
      ...result,
      sessionId: sessionId!,
      steps: spend.steps,
      spend,
      testsGreen: watch?.lastTests() ?? null,
      toolsUsed: [...toolsUsed],
    };
  };

  // ── hand-over ──
  const handover = (escalation: Escalation, lastText: string): string => {
    const calls = entries
      .flatMap((entry) =>
        entry.message.role === 'assistant' && Array.isArray(entry.message.content)
          ? entry.message.content.filter((part) => part.type === 'tool-call')
          : [],
      )
      .slice(-15)
      .map((part) => `- ${part.toolName} ${JSON.stringify(part.input).slice(0, 200)}`);
    return [
      `Übergabe von Helenas lokaler Laufzeit (${chain[0]!.id}), Grund: ${escalation.reason} (${escalation.detail}).`,
      `Aufgabe:\n${input.prompt.slice(0, 6000)}`,
      summary ? `Zusammenfassung:\n${summary.slice(0, 3000)}` : '',
      `Verlauf:\n${entries
        .slice(-10)
        .map((entry) => `${entry.message.role}: ${messageText(entry.message)}`)
        .join('\n')
        .slice(-6000)}`,
      calls.length ? `Bisherige Schritte (letzte ${calls.length}):\n${calls.join('\n')}` : '',
      lastText ? `Letzter Stand:\n${lastText.slice(0, 3000)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 20_000);
  };
  let switchedTo: string | null = null;
  let failureAttempts = 0;
  const escalate = async (
    escalation: Escalation,
    lastText: string,
  ): Promise<LoopResult | 'switched' | null> => {
    if (!escalation.target && config.escalation?.central && escalation.reason === 'failure') {
      const central = centralEscalation(
        config.escalation,
        input.prompt,
        input.env,
        escalation.detail,
        ++failureAttempts,
      );
      if (!central) return null;
      escalation = central;
    }
    const target = escalation.target ?? escalationTarget(config.escalation);
    if (
      !target ||
      switchedTo ||
      (!escalation.target && !config.escalation?.central && config.escalation?.mode === 'never')
    )
      return null;
    if (
      !escalation.target &&
      escalation.reason === 'failure' &&
      config.escalation?.onFailure === false
    )
      return null;
    if (isRuntimeTarget(target)) {
      sink.emit({
        type: 'escalate',
        target,
        reason: escalation.reason,
        detail: escalation.detail,
        handover: handover(escalation, lastText),
      });
      return finish({
        status: 'escalated',
        text: `Übergeben an ${target.slice('runtime:'.length)} (${escalation.reason}).`,
        exitCode: 3,
        reason: 'escalated',
      });
    }
    const next =
      input.escalationModel?.id === target
        ? input.escalationModel
        : (input.models.find((model) => model.id === target) ??
          input.resolveEscalationModel?.(target));
    if (!next) return null;
    switchedTo = target;
    chain = [next];
    sink.emit({ type: 'model', id: next.id });
    await save(
      [
        {
          role: 'user',
          content: `(Helena) Die Aufgabe wird an ein stärkeres Modell übergeben (${escalation.reason}: ${escalation.detail}). Mach mit dem bisherigen Verlauf weiter und bring sie zu Ende.`,
        },
      ],
      step + 1,
    );
    return 'switched';
  };

  // ── before the first step ──
  const pre =
    (config.escalation?.central
      ? centralEscalation(config.escalation, input.prompt, input.env)
      : preflightEscalation(config.escalation, input.prompt, input.labels)) ??
    (await input.uncertainty?.().catch(() => null)) ??
    null;
  if (pre) {
    const escalated = await escalate(pre, '');
    if (escalated && escalated !== 'switched') return escalated;
  }

  watch = new FailureWatch();
  let nudged = false;
  let emptyAnswerNudged = false;
  let lastText = '';
  let turns = 0;
  const contextOf = () => chain[0]!.contextLength;
  const compressAt = () =>
    config.limits?.compressAtTokens ?? Math.min(12_000, Math.floor(contextOf() * 0.6));
  let lastInputTokens = 0;

  const consumeInstructions = async () => {
    if (!input.followups) return false;
    const batch = await input.followups.consume({
      sessionId: sessionId!,
      afterSeq: seq,
      step: step + 1,
    });
    entries.push(...batch.items);
    seq = batch.items.at(-1)?.seq ?? seq;
    if (batch.replace) {
      turns = 0;
      budgetStarted = now();
    }
    if (batch.items.length) {
      lastText = '';
      nudged = false;
      emptyAnswerNudged = false;
      watch = new FailureWatch();
    }
    return batch.items.length > 0;
  };
  // Save completed tool results before an unavailable control channel can fail the turn.
  const instructionsPending = () =>
    input.followups?.pending().catch(() => true) ?? Promise.resolve(false);
  const stepSignal = () =>
    input.followups ? AbortSignal.any([input.signal, input.followups.signal]) : input.signal;

  for (;;) {
    await consumeInstructions();
    if (input.signal.aborted) {
      return finish({ status: 'failed', text: lastText, exitCode: 130, reason: 'aborted' });
    }
    const elapsed = now() - budgetStarted;
    if (elapsed >= budgetMs) {
      const escalated = await escalate({ reason: 'failure', detail: 'budget' }, lastText);
      if (escalated && escalated !== 'switched') return escalated;
      return finish({
        status: 'failed',
        text: lastText || 'Die Zeitgrenze des Laufs ist erreicht.',
        exitCode: 1,
        reason: 'budget',
      });
    }
    if (turns >= maxTurns) {
      const escalated = await escalate({ reason: 'failure', detail: 'max-turns' }, lastText);
      if (escalated && escalated !== 'switched') return escalated;
      return finish({
        status: 'failed',
        text: lastText || 'Die Schrittgrenze des Laufs ist erreicht.',
        exitCode: 1,
        reason: 'max-turns',
      });
    }
    if (elapsed >= budgetMs * 0.8 && !switchedTo) {
      const escalated = await escalate({ reason: 'failure', detail: 'budget-80' }, lastText);
      if (escalated && escalated !== 'switched') return escalated;
    }

    // ── compression ──
    if (lastInputTokens > compressAt()) {
      await compress().catch((error) => {
        process.stderr.write(`helena-agent: compression failed: ${messageOf(error)}\n`);
      });
      lastInputTokens = 0;
    }

    step += 1;
    turns += 1;
    const visible = entries.filter((entry) => entry.seq > compactedThrough);
    const messages: ModelMessage[] = [
      ...(summary
        ? [
            {
              role: 'user' as const,
              content: `Zusammenfassung des bisherigen Verlaufs:\n${summary}`,
            },
          ]
        : []),
      ...shrinkOld(visible, step),
    ];
    const toolSet: ToolSet = {};
    let offered: Set<string> = active;
    if (input.selectTools) {
      const names = await input
        .selectTools({
          prompt: messages.map(messageText).join('\n').slice(-4000),
          tools: input.tools,
        })
        .catch(() => null);
      const selected = names?.filter((name) => toolsByName.has(name));
      if (selected?.length) {
        offered = new Set(selected);
        for (const name of discovered) offered.add(name);
        if (toolsByName.has('find_tools')) offered.add('find_tools');
        for (const name of offered) active.add(name);
      }
    }
    for (const name of offered) {
      const entry = toolsByName.get(name)!;
      toolSet[name] = tool({
        description: entry.description,
        inputSchema: jsonSchema(entry.inputSchema as Parameters<typeof jsonSchema>[0]),
      });
    }

    // ── one model call, with the fallback chain ──
    let outcome: Awaited<ReturnType<typeof callModel>> | null = null;
    let lastError: unknown = null;
    for (let index = 0; index < chain.length; index++) {
      const model = chain[index]!;
      try {
        if (model.local) {
          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(new StepAbort('budget')),
            Math.max(1, budgetMs - (now() - budgetStarted)),
          );
          try {
            outcome = await queueRetry.run(
              model.id,
              AbortSignal.any([stepSignal(), controller.signal]),
              (queue) =>
                callModel(model, messages, toolSet, budgetMs - (now() - budgetStarted), queue),
              model.id !== input.models[0]!.id,
            );
          } finally {
            clearTimeout(timer);
          }
        } else {
          outcome = await callModel(model, messages, toolSet, budgetMs - (now() - budgetStarted));
        }
        if (index > 0) {
          // The first one failed: the rest of the run stays on the one that answered.
          chain = chain.slice(index);
          sink.emit({ type: 'model', id: model.id });
        }
        break;
      } catch (error) {
        lastError = error;
        if (error instanceof StepAbort && (error.why === 'aborted' || error.why === 'budget'))
          break;
        if (outcome === null && isProviderFailure(error) && index < chain.length - 1) {
          process.stderr.write(
            `helena-agent: ${model.id} failed (${messageOf(error)}), trying ${chain[index + 1]!.id}\n`,
          );
          continue;
        }
        break;
      }
    }
    if (!outcome) {
      if (!input.signal.aborted && input.followups?.signal.aborted) continue;
      if (input.signal.aborted || (lastError instanceof StepAbort && lastError.why === 'aborted')) {
        return finish({ status: 'failed', text: lastText, exitCode: 130, reason: 'aborted' });
      }
      let failureDetail = 'model-unavailable';
      if (lastError instanceof LocalModelBusy) failureDetail = 'local-model-busy';
      else if (lastError instanceof StepAbort) failureDetail = lastError.why;
      const escalated = await escalate(
        {
          reason: 'failure',
          ...(config.runtimeFallback &&
            isProviderFailure(lastError) && { target: config.runtimeFallback }),
          detail: failureDetail,
        },
        lastText,
      );
      if (escalated === 'switched') continue;
      if (escalated) return escalated;
      if (
        !(lastError instanceof LocalModelBusy) &&
        config.escalation?.central?.enabled &&
        failureAttempts < config.escalation.central.failure.localAttempts &&
        now() - budgetStarted < budgetMs
      )
        continue;
      let failureReason = 'model-unavailable';
      if (lastError instanceof LocalModelBusy) failureReason = 'local-model-busy';
      else if (lastError instanceof StepAbort && lastError.why === 'budget')
        failureReason = 'budget';
      return finish({
        status: 'failed',
        text: lastError instanceof LocalModelBusy ? lastError.message : lastText,
        exitCode: 1,
        reason: failureReason,
        ...(lastError instanceof LocalModelBusy && { error: lastError.message }),
      });
    }

    spend.steps += 1;
    spend.model = chain[0]!.id;
    spend.provider = chain[0]!.provider;
    spend.inputTokens += outcome.usage.inputTokens;
    spend.outputTokens += outcome.usage.outputTokens;
    spend.cacheReadTokens += outcome.usage.cacheReadTokens;
    spend.cacheWriteTokens += outcome.usage.cacheWriteTokens;
    spend.reasoningTokens += outcome.usage.reasoningTokens;
    lastInputTokens = outcome.usage.inputTokens;
    sink.emit({
      type: 'usage',
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
    });
    if (outcome.text.trim()) lastText = outcome.text.trim();

    const assistantContent: Exclude<
      Extract<ModelMessage, { role: 'assistant' }>['content'],
      string
    > = [];
    if (outcome.text) assistantContent.push({ type: 'text', text: outcome.text });
    for (const call of outcome.calls) {
      assistantContent.push({
        type: 'tool-call',
        toolCallId: call.id,
        toolName: call.name,
        input: call.input ?? {},
      });
    }

    if (outcome.calls.length === 0) {
      await save(
        [
          {
            role: 'assistant',
            content: assistantContent.length ? assistantContent : [{ type: 'text', text: '' }],
          },
        ],
        step,
      );
      if (await consumeInstructions()) continue;
      // A local model sometimes ends its turn announcing what it is about to do ("Ich schaue
      // mir die Seite an.") instead of doing it: it is told once to go on.
      if (!nudged && turns < maxTurns && isAnnouncement(outcome.text)) {
        nudged = true;
        await save(
          [
            {
              role: 'user',
              content:
                '(Helena) Du hast nur angekündigt, was du tun willst. Tu es jetzt mit deinen Werkzeugen und antworte erst, wenn es erledigt ist.',
            },
          ],
          step,
        );
        continue;
      }
      if (!lastText) {
        if (toolsUsed.size > 0 && !emptyAnswerNudged && turns < maxTurns) {
          emptyAnswerNudged = true;
          await save(
            [
              {
                role: 'user',
                content:
                  '(Helena) Das Werkzeug hat geantwortet, aber deine Antwort ist leer. Verwende sein Ergebnis und beantworte die Aufgabe jetzt.',
              },
            ],
            step,
          );
          continue;
        }
        return finish({ status: 'failed', text: '', exitCode: 1, reason: 'empty-answer' });
      }
      return finish({ status: 'success', text: lastText, exitCode: 0 });
    }

    // ── the tool calls of the step ──
    const results: Extract<ModelMessage, { role: 'tool' }>['content'] = [];
    let endTurn = false;
    let clarifyText = '';
    let invalid = 0;
    let looping = false;
    let warning: string | null = null;
    let deferCalls = await instructionsPending();
    for (const call of outcome.calls) {
      spend.toolCalls += 1;
      const observedName = toolName(call);
      toolsUsed.add(observedName);
      const inputJson = JSON.stringify(call.input ?? {});
      sink.emit({ type: 'tool-call', id: call.id, name: observedName, input: inputJson });
      const result =
        deferCalls || input.followups?.signal.aborted
          ? { output: { text: 'Not executed: a new instruction takes priority.', isError: true } }
          : await runTool(call);
      if (result.unknown || (call.invalid && result.output.isError)) invalid += 1;
      sink.emit({
        type: 'tool-result',
        id: call.id,
        output: result.output.text,
        ...(result.output.isError && { isError: true }),
        ...(result.output.outcome && {
          outcome: result.output.outcome,
          exitCode: result.output.exitCode,
        }),
      });
      const limited =
        result.output.text.length > DEFAULTS.toolResultChars
          ? `${result.output.text.slice(0, DEFAULTS.toolResultChars)}\n… (gekürzt)`
          : result.output.text;
      results.push({
        type: 'tool-result',
        toolCallId: call.id,
        toolName: call.name,
        output: result.output.isError
          ? { type: 'error-text', value: limited }
          : { type: 'text', value: limited },
      });
      for (const name of result.output.activate ?? []) {
        if (!toolsByName.has(name)) continue;
        active.delete(name);
        active.add(name);
        discovered.add(name);
      }
      if (result.output.endTurn) {
        endTurn = true;
        if (call.name === 'clarify')
          clarifyText = String((call.input as { question?: unknown })?.question ?? '');
      }
      const verdict = watch!.call(call.name, call.input ?? {}, result.output);
      if (verdict === 'warn') {
        warning =
          '(Helena) Du wiederholst Aufrufe, die nichts ändern. Geh anders vor oder beende den Zug mit dem, was du hast.';
      }
      if (verdict === 'loop') looping = true;
      deferCalls ||= endTurn || (await instructionsPending());
    }
    const deferred = [...active].filter((name) => !input.direct.has(name));
    for (const name of deferred.slice(0, -8)) active.delete(name);
    const stepMessages: ModelMessage[] = [
      { role: 'assistant', content: assistantContent },
      { role: 'tool', content: results },
    ];
    if (warning) stepMessages.push({ role: 'user', content: warning });
    await save(stepMessages, step);

    if (await consumeInstructions()) continue;
    if (endTurn) {
      const text = clarifyText || lastText;
      if (clarifyText) sink.emit({ type: 'text', delta: `\n\n${clarifyText}` });
      return finish({ status: 'waiting', text, exitCode: 0 });
    }
    const invalidFailure = watch!.step(invalid);
    const failure: Escalation | null = looping
      ? { reason: 'failure', detail: 'loop' }
      : invalidFailure
        ? { reason: 'failure', detail: 'invalid-tool-calls' }
        : watch!.testsFailing()
          ? { reason: 'failure', detail: 'tests-red' }
          : null;
    if (failure) {
      const escalated =
        config.escalation?.onFailure === false ? null : await escalate(failure, lastText);
      if (escalated === 'switched') continue;
      if (escalated) return escalated;
      if (looping) {
        return finish({
          status: 'failed',
          text: lastText || 'Die Arbeit kam nicht voran (wiederholte Aufrufe).',
          exitCode: 1,
          reason: 'loop',
        });
      }
    }
  }

  // ── helpers that need the loop's state ──

  function turnOptions(model: ResolvedModel, compressing = false) {
    if (
      !model.local ||
      config.reasoning ||
      model.providerOptions[providerOptionsKey(model.provider)]?.reasoningEffort === 'none'
    )
      return model.providerOptions;
    const effort = !compressing && watch?.lastTests() === false ? 'medium' : 'low';
    return {
      ...model.providerOptions,
      [providerOptionsKey(model.provider)]: {
        ...model.providerOptions[providerOptionsKey(model.provider)],
        reasoningEffort: effort,
      },
    };
  }

  async function callModel(
    model: ResolvedModel,
    messages: ModelMessage[],
    tools: ToolSet,
    leftMs: number,
    queue?: QueueAttempt,
  ) {
    const signal = stepSignal();
    const controller = new AbortController();
    let why: StepAbort['why'] | null = null;
    const stop = (reason: StepAbort['why']) => {
      if (why) return;
      why = reason;
      controller.abort();
    };
    const onAbort = () => stop('aborted');
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    const queued = model.queueAdmission && queue && queue.remainingMs > 0;
    const admissionStarted = Date.now();
    const waitingTimer = queued
      ? setTimeout(
          () =>
            sink.emit({
              type: 'status',
              status: 'model-queued',
              model: model.id,
              message: 'Wartet auf freien Modellplatz',
              retryAfterMs: 0,
              remainingMs: Math.max(0, queue.remainingMs - (Date.now() - admissionStarted)),
            }),
          1000,
        )
      : undefined;
    let watchdog = setTimeout(
      () => stop(queued ? 'model-busy' : 'first-chunk'),
      queued ? queue.remainingMs : Math.min(firstChunkMs, leftMs),
    );
    let stepTimer = queued ? undefined : setTimeout(() => stop('step-timeout'), stepMs);
    const requestModel =
      queued && typeof model.model === 'object'
        ? new Proxy(model.model, {
            get(target, property) {
              if (property !== 'doStream') return Reflect.get(target, property, target);
              return async (...args: unknown[]) => {
                // Halogen's doStream includes queue admission; generation has separate deadlines.
                const result = await Reflect.apply(Reflect.get(target, property), target, args);
                if (!controller.signal.aborted) {
                  clearTimeout(waitingTimer);
                  queue.admitted(Date.now() - admissionStarted);
                  clearTimeout(watchdog);
                  watchdog = setTimeout(() => stop('first-chunk'), firstChunkMs);
                  stepTimer = setTimeout(() => stop('step-timeout'), stepMs);
                }
                return result;
              };
            },
          })
        : model.model;
    const budgetTimer = setTimeout(() => stop('budget'), Math.max(leftMs, 1));
    const bump = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => stop('chunk'), chunkMs);
    };
    let text = '';
    const calls: { id: string; name: string; input: unknown; invalid: boolean; error?: string }[] =
      [];
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    };
    let streamError: unknown = null;
    try {
      const result = streamText({
        model: requestModel,
        instructions: input.system,
        messages,
        tools,
        abortSignal: controller.signal,
        maxRetries: 0,
        maxOutputTokens: config.limits?.maxOutputTokens ?? DEFAULTS.maxOutputTokens,
        providerOptions: turnOptions(model) as never,
        onError: ({ error }) => {
          streamError ??= error;
        },
      });
      // The stream is read against the step's own abort: a provider that ignores the
      // abort (or a retry started after it) must not keep the step open.
      const aborted = new Promise<never>((_, reject) => {
        const fail = () => reject(new StepAbort(why ?? 'aborted'));
        if (controller.signal.aborted) fail();
        else controller.signal.addEventListener('abort', fail, { once: true });
      });
      aborted.catch(() => {});
      const iterator = result.stream[Symbol.asyncIterator]();
      for (;;) {
        const next = await Promise.race([iterator.next(), aborted]);
        if (next.done) break;
        const part = next.value;
        // The SDK's own frames come before the model says anything.
        if (part.type !== 'start' && part.type !== 'start-step') bump();
        switch (part.type) {
          case 'text-delta':
            if (part.text) {
              text += part.text;
              sink.emit({ type: 'text', delta: part.text });
            }
            break;
          case 'reasoning-delta':
            if (part.text) sink.emit({ type: 'thinking', delta: part.text });
            break;
          case 'tool-call': {
            const dynamic = part as { invalid?: boolean; error?: unknown };
            calls.push({
              id: part.toolCallId,
              name: part.toolName,
              input: part.input,
              invalid: dynamic.invalid === true,
              ...(dynamic.error !== undefined && { error: messageOf(dynamic.error) }),
            });
            break;
          }
          case 'finish-step': {
            const u = part.usage;
            usage.inputTokens += u.inputTokens ?? 0;
            usage.outputTokens += u.outputTokens ?? 0;
            usage.cacheReadTokens += u.inputTokenDetails?.cacheReadTokens ?? 0;
            usage.cacheWriteTokens += u.inputTokenDetails?.cacheWriteTokens ?? 0;
            usage.reasoningTokens += u.outputTokenDetails?.reasoningTokens ?? 0;
            break;
          }
          case 'error':
            streamError ??= part.error;
            break;
          default:
            break;
        }
      }
    } catch (error) {
      streamError ??= error;
    } finally {
      clearTimeout(waitingTimer);
      clearTimeout(watchdog);
      clearTimeout(budgetTimer);
      clearTimeout(stepTimer);
      signal.removeEventListener('abort', onAbort);
    }
    if (why === 'model-busy') throw new LocalModelBusy();
    if (why) throw new StepAbort(why);
    if (streamError && calls.length === 0 && !text) throw streamError;
    return { text, calls, usage };
  }

  function toolName(call: { name: string; input: unknown }): string {
    return call.name === 'load_name' &&
      typeof call.input === 'object' &&
      call.input !== null &&
      'name' in call.input &&
      typeof call.input.name === 'string'
      ? 'load_skill'
      : call.name;
  }

  async function runTool(call: {
    id: string;
    name: string;
    input: unknown;
    invalid: boolean;
    error?: string;
  }): Promise<{ output: ToolOutput; unknown?: boolean }> {
    const actualName = toolName(call);
    const entry = toolsByName.get(actualName);
    if (!entry || !active.has(actualName)) {
      return {
        unknown: true,
        output: {
          text: entry
            ? `The tool ${call.name} is not loaded. Find it with find_tools first.`
            : `There is no tool ${call.name}.`,
          isError: true,
        },
      };
    }
    if (
      call.invalid &&
      !(actualName === 'load_skill' && /unavailable tool ['"]load_name['"]/.test(call.error ?? ''))
    ) {
      return {
        output: {
          text: `The arguments did not match the tool's schema${call.error ? ` (${call.error})` : ''}. Send valid JSON for ${call.name}.`,
          isError: true,
        },
      };
    }
    const args = (call.input && typeof call.input === 'object' ? call.input : {}) as Record<
      string,
      unknown
    >;
    if (entry.kind === 'browser' && browserLeftMs <= 0) {
      return {
        output: {
          text: 'The browser time of this task is used up. Answer with what you found.',
          isError: true,
        },
      };
    }
    const question = entry.readOnly ? null : (entry.question?.(args) ?? null);
    const timeout = Math.min(
      entry.timeoutMs ?? toolTimeoutMs,
      entry.kind === 'browser' ? browserLeftMs : Number.POSITIVE_INFINITY,
      Math.max(budgetMs - (now() - budgetStarted), 1),
    );
    const signal = stepSignal();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal.aborted) controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const began = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let execution: Promise<ToolOutput> | undefined;
    try {
      const output = await Promise.race([
        (execution = (async (): Promise<ToolOutput> => {
          if (question) {
            const decision = await input.policy(question);
            if (!decision.allowed) return { text: decision.message, isError: true };
          }
          controller.signal.throwIfAborted();
          return entry.execute(args, {
            workdir: config.workdir,
            signal: controller.signal,
            env: input.env,
            hasTool: (name) => toolsByName.has(name),
          });
        })()),
        new Promise<ToolOutput>((resolve) => {
          const aborted = () => resolve({ text: 'The tool was stopped.', isError: true });
          if (controller.signal.aborted) aborted();
          else controller.signal.addEventListener('abort', aborted, { once: true });
        }),
        new Promise<ToolOutput>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve({
              text: `The tool ${call.name} took longer than ${Math.round(timeout / 1000)} s and was stopped.`,
              isError: true,
            });
          }, timeout);
        }),
      ]);
      if (input.followups?.signal.aborted) await execution?.catch(() => {});
      return { output };
    } catch (error) {
      return {
        output: { text: `The tool ${call.name} failed: ${messageOf(error)}`, isError: true },
      };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (entry.kind === 'browser') browserLeftMs -= now() - began;
    }
  }

  // The original messages remain durable; only the prompt replaces them with a summary.
  async function compress(): Promise<void> {
    const keepFrom = step - 5;
    const old = entries.filter((entry) => entry.seq > compactedThrough && entry.step < keepFrom);
    if (old.length < 4) return;
    const through = old.at(-1)!.seq;
    const transcript = redactSecrets(
      old.map((entry) => `${entry.message.role}: ${renderForSummary(entry.message)}`).join('\n'),
    );
    let next = summary;
    for (let offset = 0; offset < transcript.length; offset += 20_000) {
      const result = await generateText({
        model: chain[0]!.model,
        providerOptions: turnOptions(chain[0]!, true) as never,
        maxOutputTokens: 1500,
        instructions:
          'Schreibe ausschließlich eine Zusammenfassung auf Deutsch mit genau diesen Überschriften: ' +
          'Ziel, Stand, Entscheidungen, Offene Aufgaben, Wichtige Referenzen. ' +
          'Erhalte wichtige Fakten, Dateipfade und Werkzeugergebnisse. Schreibe nie eine Frage oder ' +
          'eine Aufforderung an den Nutzer. Keine Geheimnisse. Höchstens 400 Wörter.',
        prompt: `${next ? `Frühere Zusammenfassung:\n${next}\n\n` : ''}Verlauf:\n${transcript.slice(offset, offset + 20_000)}`,
        abortSignal: AbortSignal.any([
          input.signal,
          AbortSignal.timeout(
            Math.max(1, Math.min(stepMs, Math.floor(budgetMs - (now() - budgetStarted)))),
          ),
        ]),
        maxRetries: 0,
      });
      spend.inputTokens += result.usage.inputTokens ?? 0;
      spend.outputTokens += result.usage.outputTokens ?? 0;
      spend.cacheReadTokens += result.usage.inputTokenDetails?.cacheReadTokens ?? 0;
      spend.cacheWriteTokens += result.usage.inputTokenDetails?.cacheWriteTokens ?? 0;
      spend.reasoningTokens += result.usage.outputTokenDetails?.reasoningTokens ?? 0;
      next =
        structuredSummary(redactSecrets(result.text)) ??
        structuredSummary(
          `Verlauf und Werkzeugergebnisse: ${`${next ?? ''}\n${transcript.slice(offset, offset + 20_000)}`.replace(/\?(?=\s|$)/g, '.').slice(-6_000)}`,
        );
      if (!next || looksSecret(next)) return;
    }
    if (!next || looksSecret(next)) return;
    if (input.note) {
      const flush = next.replace(/\s+/g, ' ');
      for (let offset = 0; offset < flush.length; offset += 1600) {
        const marker = `[compaction:${sessionId}:${through}:${offset / 1600}]`;
        await input.note(`${marker} ${flush.slice(offset, offset + 1600)}`);
      }
    }
    await sessions.compact(sessionId!, next, through);
    summary = next;
    compactedThrough = through;
  }
}

export function structuredSummary(text: string): string | null {
  const body = text.trim();
  if (
    !body ||
    (body.endsWith('?') && !body.includes('\n')) ||
    /\b(?:can you|could you|kannst du|könntest du|please clarify|bitte kläre)\b[^\n]*\?/i.test(
      body,
    ) ||
    /^(?:frage|question|clarif|bitte (?:sag|teile|kläre))/i.test(body)
  )
    return null;
  const headings = ['Ziel', 'Stand', 'Entscheidungen', 'Offene Aufgaben', 'Wichtige Referenzen'];
  if (headings.every((heading) => new RegExp(`^#{0,3}\\s*${heading}:?\\s*$`, 'mi').test(body))) {
    return headings
      .map((heading, index) => {
        const start = new RegExp(`^#{0,3}\\s*${heading}:?\\s*$`, 'mi').exec(body)!;
        const rest = body.slice(start.index + start[0].length);
        const following = headings[index + 1];
        const end = following
          ? new RegExp(`^#{0,3}\\s*${following}:?\\s*$`, 'mi').exec(rest)?.index
          : undefined;
        return `## ${heading}\n${rest.slice(0, end).trim().slice(0, 1500) || 'Nicht angegeben.'}`;
      })
      .join('\n\n');
  }
  return headings
    .map(
      (heading) =>
        `## ${heading}\n${heading === 'Stand' ? body.slice(0, 6_000) : 'Nicht angegeben.'}`,
    )
    .join('\n\n');
}

// A short answer that only says what the model is going to do next.
const ANNOUNCEMENT =
  /^(ich (schaue|sehe|prüfe|werde|mache|suche|öffne|lese|hole|starte|fange)|jetzt (schaue|prüfe|öffne)|lass mich|let me|i('ll| will| am going to)|now i)\b/i;

export function isAnnouncement(text: string): boolean {
  const trimmed = text.trim();
  // One short sentence, nothing after a colon or a full stop, and no question.
  return (
    trimmed.length > 0 &&
    trimmed.length < 160 &&
    ANNOUNCEMENT.test(trimmed) &&
    !/[.!:;]\s+\S/.test(trimmed) &&
    !/\?\s*$/.test(trimmed)
  );
}

export function resultEvent(result: {
  status: LoopResult['status'];
  text: string;
  exitCode: number;
  reason?: string;
  error?: string;
}): ResultEvent {
  return {
    type: 'result',
    text: result.text,
    exitCode: result.exitCode,
    ...(result.reason && { reason: result.reason }),
    ...(result.exitCode !== 0 &&
      result.status !== 'escalated' && { error: result.error ?? result.reason ?? 'failed' }),
  };
}

function renderForSummary(message: ModelMessage): string {
  if (typeof message.content === 'string') return message.content.slice(0, 4000);
  return message.content
    .map((part) => {
      if (part.type === 'text') return part.text.slice(0, 4000);
      if (part.type === 'tool-call')
        return `[ruft ${part.toolName} ${JSON.stringify(part.input).slice(0, 300)}]`;
      if (part.type === 'tool-result') {
        const output = part.output;
        const value =
          'value' in output
            ? typeof output.value === 'string'
              ? output.value
              : JSON.stringify(output.value)
            : '';
        return `[${part.toolName} → ${value.slice(0, 600)}]`;
      }
      return '';
    })
    .join(' ');
}
