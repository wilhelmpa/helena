import { describe, expect, it } from 'bun:test';
import { clip, runToolLoop, toOpenAiTools } from './loop';
import { SCENARIO, checkScenario, scenarioPrompt, type ScenarioFacts } from './scenario';

// The practice test's tool loop and its checks, without a model or Helena.

const TOOLS = toOpenAiTools([
  { name: 'create_project', description: 'Create a project', inputSchema: { type: 'object' } },
  { name: 'list_projects', description: 'x'.repeat(2000) },
]);

function scripted(replies: Record<string, unknown>[]) {
  const bodies: Record<string, unknown>[] = [];
  return {
    bodies,
    post: async (body: Record<string, unknown>) => {
      bodies.push(structuredClone(body));
      const reply = replies.shift();
      if (!reply) throw new Error('no reply left');
      return {
        choices: [{ message: reply }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      };
    },
  };
}

const call = (name: string, args: string, id = 'c1') => ({
  content: null,
  tool_calls: [{ id, function: { name, arguments: args } }],
});

describe('the tool loop', () => {
  it('calls the tools the model asks for and ends on its answer', async () => {
    const model = scripted([
      call('create_project', '{"key":"FLX","name":"Praxistest Flash"}'),
      { content: 'Fertig: FLX angelegt.' },
    ]);
    const calls: [string, unknown][] = [];
    const result = await runToolLoop({
      system: 's',
      prompt: 'p',
      tools: TOOLS,
      post: model.post,
      callTool: async (name, args) => {
        calls.push([name, args]);
        return { text: '{"key":"FLX"}', isError: false };
      },
      maxTurns: 5,
      deadlineMs: 60_000,
      request: { model: 'm', temperature: 0 },
    });
    expect(result.stopped).toBe('answered');
    expect(result.answer).toBe('Fertig: FLX angelegt.');
    expect(calls).toEqual([['create_project', { key: 'FLX', name: 'Praxistest Flash' }]]);
    expect(result.toolCalls).toMatchObject([{ turn: 1, name: 'create_project', ok: true }]);
    expect(result.inputTokens).toBe(200);
    // The second request carries the tool result after the assistant's call.
    const messages = model.bodies[1]!.messages as { role: string; content: string }[];
    expect(messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
    ]);
    expect(messages[3]!.content).toBe('{"key":"FLX"}');
    expect(model.bodies[0]).toMatchObject({ model: 'm', temperature: 0, tool_choice: 'auto' });
  });

  it('counts bad arguments, unknown tools, tool errors and repeats, and lets the model go on', async () => {
    const model = scripted([
      call('create_project', '{not json'),
      call('drop_database', '{}'),
      call('create_project', '{"key":"X"}'),
      call('create_project', '{"key":"X"}'),
      { content: 'ok' },
    ]);
    const result = await runToolLoop({
      system: 's',
      prompt: 'p',
      tools: TOOLS,
      post: model.post,
      callTool: async () => ({ text: 'Key already taken', isError: true }),
      maxTurns: 10,
      deadlineMs: 60_000,
    });
    expect(result.toolCalls.map((entry) => [entry.ok, entry.error?.slice(0, 18)])).toEqual([
      [false, 'invalid arguments:'],
      [false, 'unknown tool drop_'],
      [false, 'Key already taken'],
      [false, 'Key already taken'],
    ]);
    expect(result.loops).toBe(1);
    expect(result.stopped).toBe('answered');
  });

  it('stops at the turn limit and at the deadline', async () => {
    const endless = { post: async () => ({ choices: [{ message: call('list_projects', '{}') }] }) };
    const turns = await runToolLoop({
      system: 's',
      prompt: 'p',
      tools: TOOLS,
      post: endless.post,
      callTool: async () => ({ text: '[]', isError: false }),
      maxTurns: 3,
      deadlineMs: 60_000,
    });
    expect(turns).toMatchObject({ stopped: 'turns', turns: 3 });
    let clock = 0;
    const late = await runToolLoop({
      system: 's',
      prompt: 'p',
      tools: TOOLS,
      post: async () => {
        clock += 40_000;
        return endless.post();
      },
      callTool: async () => ({ text: '[]', isError: false }),
      maxTurns: 10,
      deadlineMs: 60_000,
      now: () => clock,
    });
    expect(late.stopped).toBe('time');
  });

  it('clips long descriptions and results', () => {
    expect(TOOLS[1]!.function.description).toHaveLength(600);
    expect(TOOLS[1]!.function.parameters).toEqual({ type: 'object', properties: {} });
    expect(clip('abcdef', 3)).toBe('abc\n… (3 more characters)');
  });
});

function fullFacts(): ScenarioFacts {
  return {
    project: { id: 1, key: 'FLX', name: 'Praxistest Flash' },
    agents: SCENARIO.agents.map((agent, index) => ({
      username: agent.username,
      name: agent.name,
      userId: `u${index}`,
      projectKeys: ['FLX'],
    })),
    goals: [...SCENARIO.goals],
    tasks: SCENARIO.tasks.map((task) => ({ title: task.title, delegateUsername: task.delegate })),
    routines: [
      {
        title: 'Wochenbericht',
        cron: '0 9 * * 1',
        timezone: 'Europe/Berlin',
        agentUsername: 'praxis-koord',
      },
    ],
    runs: 3,
    routineFired: true,
  };
}

describe('the scenario checks', () => {
  it('pass for everything the spec asks for', () => {
    const checks = checkScenario(
      fullFacts(),
      'Projekt FLX angelegt, zwei Agenten, zwei Ziele, drei Aufgaben, Routine Wochenbericht einmal gestartet.',
    );
    expect(checks.filter((check) => !check.passed)).toEqual([]);
    expect(checks).toHaveLength(13);
  });

  it('fail for a wrong delegate, a duplicate, a missing routine fire and an empty report', () => {
    const facts = fullFacts();
    facts.tasks[0]!.delegateUsername = 'praxis-koord';
    facts.tasks.push({ ...facts.tasks[1]! });
    facts.routineFired = false;
    const failed = checkScenario(facts, '')
      .filter((check) => !check.passed)
      .map((check) => check.id);
    expect(failed).toEqual([
      'task:Kundenfeedback der letzten Woche auswerten',
      'tasks:no-duplicates',
      'routine:fired',
      'report',
    ]);
  });

  it('asks for every part in the prompt', () => {
    const prompt = scenarioPrompt();
    for (const text of [
      'FLX',
      'praxis-koord',
      'praxis-recherche',
      'Kundenzufriedenheit steigern',
      '0 9 * * 1',
      'Statusbericht',
    ])
      expect(prompt).toContain(text);
  });
});
