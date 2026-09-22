import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgentMessage,
  buildChatMessage,
  ItsaplanRunner,
  normalizeRunnerConfig,
  projectModelCatalog,
  toolEventsFromMessages,
} from './runner-core.js';

test('normalizes one fixed mapping and enables chat', () => {
  const config = normalizeRunnerConfig({
    agents: { reviewer: { openclawAgentId: 'reviewer', apiKey: 'secret' } },
  });
  assert.equal(config.baseUrl, 'https://plan-api.volition.one');
  assert.equal(config.requestTimeoutMs, 30000);
  assert.equal(config.chatEnabled, true);
  assert.equal(config.settleGraceMs, 120000);
  assert.equal(config.settlePollMs, 2000);
  assert.equal(config.agents[0].openclawAgentId, 'reviewer');
});

test('frames autonomous work and direct chat differently', () => {
  const work = buildAgentMessage({
    issueIdentifier: 'VERV-1',
    systemPrompt: 'system text',
    prompt: 'task text',
  });
  assert.match(work, /autonomous task/);
  assert.match(work, /normal OpenClaw tools/);
  assert.match(work, /VERV-1/);
  const firstChat = buildChatMessage({
    systemPrompt: 'dynamic Plan context',
    prompt: 'hello',
    sessionId: null,
  });
  assert.equal(firstChat, 'hello');
  const followUp = buildChatMessage({
    systemPrompt: 'dynamic Plan context',
    prompt: 'hello again',
    sessionId: 'agent:writer:itsaplan-chat-thread-a',
  });
  assert.equal(followUp, 'hello again');
  assert.equal(buildChatMessage({ prompt: 'think' }, 'high'), '/think:high\nthink');
});

test('projects every host-allowed available model with its thinking policy', () => {
  const calls = [];
  const catalog = [
    { provider: 'openai', id: 'gpt-6-astra', name: 'GPT-6-Astra' },
    {
      provider: 'openai',
      id: 'gpt-5.6-sol',
      name: 'GPT-5.6-Sol',
      reasoning: true,
    },
    { provider: 'openai', id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' },
    { provider: 'openai', id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna' },
    { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5' },
    { provider: 'other', id: 'configured-but-denied', name: 'Denied' },
    { provider: 'openai', id: 'disabled', name: 'Disabled', status: 'disabled' },
  ];
  const models = projectModelCatalog(
    catalog,
    (raw) =>
      raw.startsWith('openai/') ? { ref: splitTestModel(raw), key: raw } : { error: 'denied' },
    (request) => {
      calls.push(request);
      return {
        levels: request.model === 'gpt-5.5' ? [{ id: 'low' }] : [{ id: 'low' }, { id: 'high' }],
        defaultLevel: request.model.endsWith('sol') ? 'high' : 'low',
      };
    },
  );
  assert.deepEqual(
    models.map((model) => model.id),
    [
      'openai/gpt-6-astra',
      'openai/gpt-5.6-sol',
      'openai/gpt-5.6-terra',
      'openai/gpt-5.6-luna',
      'openai/gpt-5.5',
    ],
  );
  assert.deepEqual(models[1].thinkingLevels, ['low', 'high']);
  assert.equal(models[1].thinkingDefault, 'high');
  assert.deepEqual(models[4].thinkingLevels, ['low']);
  assert.equal(calls.length, 5);
  assert.equal(
    calls.every((call) => call.catalog === catalog),
    true,
  );
});

test('claims, runs with tools, and reports without exposing the key', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/claim')) {
      return response(200, {
        run: {
          id: 7,
          issueId: 5,
          sourceActivityId: 19,
          prompt: 'Review',
          systemPrompt: 'Context',
          issueIdentifier: 'VERV-7',
        },
      });
    }
    return response(204);
  };
  const runs = [];
  const runner = new ItsaplanRunner({
    config: {
      chatEnabled: false,
      agents: {
        reviewer: { openclawAgentId: 'reviewer', apiKey: 'top-secret' },
      },
    },
    fetchImpl,
    run: async (params) => {
      runs.push(params);
      return { runId: 'run-1', sessionKey: params.sessionKey };
    },
    waitForRun: async () => ({
      status: 'ok',
      terminalReply: { disposition: 'visible', text: 'done by reviewer' },
    }),
    logger: { warn() {} },
  });
  await runner.claimAndStart(runner.config.agents[0]);
  await Promise.allSettled([...runner.inFlight]);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.headers['x-api-key'], 'top-secret');
  assert.equal(runs[0].disableTools, false);
  assert.equal(runs[0].sessionKey, 'agent:reviewer:itsaplan-issue-5');
  assert.equal(calls[1].url.endsWith('/issues/5/comments'), true);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    body: 'done by reviewer',
    replyToId: 19,
  });
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    status: 'success',
    output: 'done by reviewer',
  });
});

test('answers chat, binds the thread session, and closes the message', async () => {
  const calls = [];
  let runRequest;
  const runner = new ItsaplanRunner({
    config: {
      agents: { writer: { openclawAgentId: 'writer', apiKey: 'secret' } },
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/events')) return response(200, { canceled: false });
      return response(204);
    },
    run: async (params) => {
      runRequest = params;
      return { runId: 'chat-run', sessionKey: params.sessionKey };
    },
    waitForRun: async () => ({
      status: 'ok',
      terminalReply: { disposition: 'visible', text: 'Hallo aus dem Chat' },
    }),
    loadModelCatalog: async () => [{ provider: 'openai', id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol' }],
    resolveModelSelection: ({ raw }) => ({ ref: splitTestModel(raw), key: raw }),
    normalizeThinkingLevel: (value) => value,
    resolveDefaultModel: () => ({ provider: 'openai', model: 'gpt-5.6-sol' }),
    resolveThinkingPolicy: () => ({
      levels: [{ id: 'low' }, { id: 'high' }],
      defaultLevel: 'high',
    }),
    logger: { warn() {} },
  });
  await runner.processChat(runner.config.agents[0], {
    id: 11,
    threadId: 'thread-a',
    prompt: 'Hallo',
    systemPrompt: 'Kurz antworten',
    model: 'openai/gpt-5.6-sol',
    thinkingLevel: 'high',
    sessionId: null,
  });
  assert.equal(calls.length, 3);
  assert.equal(runRequest.message, '/think:high\nHallo');
  assert.equal(runRequest.provider, 'openai');
  assert.equal(runRequest.model, 'gpt-5.6-sol');
  assert.equal(
    runRequest.extraSystemPrompt,
    'The runner delivers your reply to Plan. Do not send it through Plan or messaging tools.',
  );
  const started = JSON.parse(calls[0].options.body);
  assert.equal(started.sessionId, 'agent:writer:itsaplan-chat-thread-a');
  const finished = JSON.parse(calls[1].options.body);
  assert.equal(
    finished.events.some((event) => event.type === 'TEXT_MESSAGE_CONTENT'),
    true,
  );
  assert.deepEqual(JSON.parse(calls[2].options.body), { status: 'success' });
});

test('normalizes thinking through the host and enforces the selected model policy', () => {
  const runner = new ItsaplanRunner({
    config: {
      agents: { writer: { openclawAgentId: 'writer', apiKey: 'secret' } },
    },
    normalizeThinkingLevel: (value) =>
      value === 'extra high' ? 'xhigh' : value === 'low' ? 'low' : undefined,
    resolveDefaultModel: () => ({ provider: 'openai', model: 'gpt-5.6-sol' }),
    resolveThinkingPolicy: ({ model }) => ({
      levels: model === 'gpt-5.6-sol' ? [{ id: 'low' }, { id: 'xhigh' }] : [{ id: 'low' }],
    }),
  });
  assert.equal(
    runner.resolveChatThinkingLevel(
      runner.config.agents[0],
      {
        ref: { provider: 'openai', model: 'gpt-5.6-sol' },
        catalog: [],
      },
      'extra high',
    ),
    'xhigh',
  );
  assert.throws(
    () =>
      runner.resolveChatThinkingLevel(
        runner.config.agents[0],
        { ref: { provider: 'openai', model: 'gpt-5.6-luna' }, catalog: [] },
        'extra high',
      ),
    /not supported/,
  );
  assert.throws(
    () => runner.resolveChatThinkingLevel(runner.config.agents[0], undefined, 'nonsense'),
    /Invalid thinking level/,
  );
});

test('rejects a model that current host policy no longer allows before dispatch', async () => {
  let dispatched = false;
  const runner = new ItsaplanRunner({
    config: {
      agents: { writer: { openclawAgentId: 'writer', apiKey: 'secret' } },
    },
    loadModelCatalog: async () => [{ provider: 'openai', id: 'gpt-6-astra', name: 'GPT-6-Astra' }],
    resolveModelSelection: () => ({ error: 'blocked by current model policy' }),
    run: async () => {
      dispatched = true;
    },
  });
  await assert.rejects(
    () =>
      runner.runOpenClaw({
        agent: runner.config.agents[0],
        sessionKey: 'agent:writer:itsaplan-chat-thread',
        message: 'hello',
        model: 'openai/gpt-6-astra',
      }),
    /blocked by current model policy/,
  );
  assert.equal(dispatched, false);
});

test('maps tool calls and results from the current OpenClaw turn to AG-UI events', () => {
  const events = toolEventsFromMessages(
    [
      {
        role: 'assistant',
        timestamp: 110,
        content: [
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'itsaplan__list_projects',
            arguments: {},
          },
        ],
      },
      {
        role: 'toolResult',
        timestamp: 120,
        content: [
          {
            type: 'toolResult',
            toolCallId: 'call-1',
            name: 'itsaplan__list_projects',
            text: '[{"key":"PRIV"}]',
          },
        ],
      },
      {
        role: 'assistant',
        timestamp: 90,
        content: [{ type: 'toolCall', id: 'stale', name: 'ignored', arguments: {} }],
      },
    ],
    100,
  );
  assert.deepEqual(
    events.map((event) => event.type),
    ['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_RESULT'],
  );
  assert.equal(events[0].toolCallName, 'itsaplan__list_projects');
  assert.equal(events[1].delta, '[redacted]');
  assert.equal(events[3].content, '[redacted]');
});

test('forwards live assistant deltas and tool events without polling', async () => {
  const calls = [];
  let started;
  const runner = new ItsaplanRunner({
    config: {
      agents: { writer: { openclawAgentId: 'writer', apiKey: 'secret' } },
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/events')) return response(200, { canceled: false });
      return response(204);
    },
    run: async (params) => {
      started = params;
      return { runId: 'live-run', sessionKey: params.sessionKey };
    },
    waitForRun: async () => {
      runner.handleAgentEvent({
        runId: 'live-run',
        stream: 'assistant',
        data: { text: 'Hallo' },
      });
      runner.handleAgentEvent({
        runId: 'live-run',
        stream: 'assistant',
        data: { text: 'Hallo Welt' },
      });
      runner.handleAgentEvent({
        runId: 'live-run',
        stream: 'tool',
        data: {
          phase: 'start',
          toolCallId: 'call-1',
          name: 'read',
          args: { path: '/tmp/a' },
        },
      });
      runner.handleAgentEvent({
        runId: 'live-run',
        stream: 'tool',
        data: { phase: 'result', toolCallId: 'call-1', result: 'ok' },
      });
      return {
        status: 'ok',
        terminalReply: { disposition: 'visible', text: 'Hallo Welt' },
      };
    },
    logger: { warn() {} },
  });
  await runner.processChat(runner.config.agents[0], {
    id: 12,
    threadId: 'thread-live',
    prompt: 'Hallo',
    systemPrompt: '',
    sessionId: null,
  });
  assert.ok(started);
  const batches = calls
    .filter((call) => call.url.endsWith('/events'))
    .flatMap((call) => JSON.parse(call.options.body).events);
  assert.equal(batches.filter((event) => event.type === 'TEXT_MESSAGE_START').length, 1);
  assert.equal(
    batches
      .filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')
      .map((event) => event.delta)
      .join(''),
    'Hallo Welt',
  );
  assert.ok(batches.some((event) => event.type === 'TOOL_CALL_RESULT'));
  assert.ok(
    batches
      .filter((event) => event.type === 'TOOL_CALL_ARGS')
      .every((event) => event.delta === '[redacted]'),
  );
  assert.ok(
    batches
      .filter((event) => event.type === 'TOOL_CALL_RESULT')
      .every((event) => event.content === '[redacted]'),
  );
});

test('event cancellation cancels the exact bound OpenClaw task once and suppresses success', async () => {
  const calls = [];
  const cancelCalls = [];
  let eventCount = 0;
  const runner = new ItsaplanRunner({
    config: {
      agents: { writer: { openclawAgentId: 'writer', apiKey: 'secret' } },
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/events')) {
        eventCount += 1;
        return response(200, { canceled: eventCount === 2 });
      }
      return response(204);
    },
    run: async (params) => ({
      runId: 'cancel-run',
      sessionKey: params.sessionKey,
    }),
    waitForRun: async () => {
      runner.handleAgentEvent({
        runId: 'cancel-run',
        stream: 'assistant',
        data: { delta: 'partial' },
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        status: 'ok',
        terminalReply: { disposition: 'visible', text: 'partial final' },
      };
    },
    cancelRun: async (params) => {
      cancelCalls.push(params);
      return {
        found: true,
        cancelled: true,
        task: { id: 'task-1', runId: params.runId, status: 'cancelled' },
      };
    },
    logger: { warn() {} },
  });
  await runner.processChat(runner.config.agents[0], {
    id: 13,
    threadId: 'thread unsafe/../id',
    prompt: 'Hallo',
    systemPrompt: '',
    sessionId: 'agent:writer:itsaplan-chat-arbitrary',
  });
  assert.deepEqual(cancelCalls, [
    {
      agentId: 'writer',
      runId: 'cancel-run',
    },
  ]);
  assert.equal(
    calls.some(
      (call) => call.url.endsWith('/result') && JSON.parse(call.options.body).status === 'success',
    ),
    false,
  );
});

test('waits for a delegated final answer and ignores stale session text', async () => {
  const now = Date.now();
  let reads = 0;
  const runner = new ItsaplanRunner({
    config: {
      chatEnabled: false,
      settleGraceMs: 100,
      settlePollMs: 1,
      agents: {
        coordinator: { openclawAgentId: 'coordinator', apiKey: 'secret' },
      },
    },
    fetchImpl: async () => response(204),
    run: async (params) => ({
      runId: 'delegated-run',
      sessionKey: params.sessionKey,
    }),
    waitForRun: async () => ({ status: 'ok', terminalReply: null }),
    getSessionMessages: async () => {
      reads += 1;
      return {
        messages: [
          {
            role: 'assistant',
            timestamp: now - 1000,
            content: [{ type: 'text', text: 'stale answer' }],
          },
          ...(reads >= 2
            ? [
                {
                  role: 'assistant',
                  timestamp: now + 1000,
                  content: [{ type: 'text', text: 'delegated PASS' }],
                },
              ]
            : []),
        ],
      };
    },
    logger: { warn() {} },
  });
  runner.stopped = false;
  const result = await runner.runOpenClaw({
    agent: runner.config.agents[0],
    sessionKey: 'agent:coordinator:itsaplan-issue-1',
    message: 'delegate',
    idempotencyKey: 'run-1',
    extraSystemPrompt: '',
  });
  assert.equal(result.text, 'delegated PASS');
  assert.ok(reads >= 2);
});

test('does not reuse a stale answer when settle grace expires', async () => {
  const runner = new ItsaplanRunner({
    config: {
      chatEnabled: false,
      settleGraceMs: 5,
      settlePollMs: 1,
      agents: {
        coordinator: { openclawAgentId: 'coordinator', apiKey: 'secret' },
      },
    },
    fetchImpl: async () => response(204),
    run: async (params) => ({
      runId: 'no-answer',
      sessionKey: params.sessionKey,
    }),
    waitForRun: async () => ({ status: 'ok', terminalReply: null }),
    getSessionMessages: async () => ({
      messages: [
        {
          role: 'assistant',
          timestamp: Date.now() - 60_000,
          content: [{ type: 'text', text: 'old' }],
        },
      ],
    }),
    logger: { warn() {} },
  });
  runner.stopped = false;
  await assert.rejects(
    runner.runOpenClaw({
      agent: runner.config.agents[0],
      sessionKey: 'agent:coordinator:itsaplan-issue-1',
      message: 'delegate',
      idempotencyKey: 'run-2',
      extraSystemPrompt: '',
    }),
    /after settle grace/,
  );
});

test('applies a runtime-neutral policy once per revision and reports adapter status', async () => {
  const applied = [];
  const statuses = [];
  const snapshot = {
    revision: 'rev-1',
    instructions: 'Answer in German.',
    model: 'openai/gpt-5.6-sol',
    memory: { enabled: true, lastMessages: 20 },
    runtimePolicy: {
      reasoningEffort: 'high',
      toolAllow: ['browser'],
      toolDeny: [],
      mcpGrants: ['itsaplan__get_issue'],
      files: [],
    },
    projects: [],
    skills: [],
    configuredTools: [],
  };
  const runner = new ItsaplanRunner({
    config: {
      chatEnabled: false,
      agents: {
        writer: { openclawAgentId: 'writer', apiKey: 'secret' },
        reviewer: { openclawAgentId: 'reviewer', apiKey: 'secret-2' },
      },
    },
    fetchImpl: async (url, options) => {
      if (url.endsWith('/agent-runtime/policy')) return response(200, snapshot);
      if (url.endsWith('/agent-runtime/status')) {
        statuses.push(JSON.parse(options.body));
        return response(200, {});
      }
      return response(204);
    },
    applyRuntimePolicies: async (policies) => applied.push(policies),
    adapterId: 'openclaw',
    adapterCapabilities: ['model', 'reasoning'],
    logger: { warn() {} },
  });

  await runner.syncRuntimePolicies();
  await runner.syncRuntimePolicies();
  assert.equal(applied.length, 1);
  assert.equal(applied[0].length, 2);
  assert.equal(applied[0][0].snapshot.instructions, 'Answer in German.');
  assert.equal(statuses.length, 4);
  assert.deepEqual(statuses[0], {
    adapter: 'openclaw',
    status: 'online',
    appliedRevision: 'rev-1',
    capabilities: ['model', 'reasoning'],
    detail: null,
  });
});

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function splitTestModel(raw) {
  const slash = raw.indexOf('/');
  return { provider: raw.slice(0, slash), model: raw.slice(slash + 1) };
}
