import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { db, helenaDecisionEval } from '@repo/db';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import { AVA_COMMAND_CLASS, parseAvaCommand } from '../../ava-questions';
import { TOOL_SELECTION_CLASS } from '../../tool-selection-questions';

let server: ReturnType<typeof Bun.serve>;
let uncertain = false;
let calls = 0;
let decisionDelayMs = 0;
beforeAll(() => {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      calls++;
      if (decisionDelayMs) await Bun.sleep(decisionDelayMs);
      const body = (await request.json()) as {
        state: { prompt?: string };
        questions: Record<string, { criteria: Record<string, unknown> }>;
      };
      const action = parseAvaCommand(body.state.prompt ?? '')?.action ?? 'fallback';
      return Response.json({
        model: 'jev-synthetic',
        usage: { input_tokens: 10, output_tokens: 1 },
        answers: Object.fromEntries(
          Object.entries(body.questions).map(([id, question]) => {
            const options = Object.keys(question.criteria);
            const choices: Record<string, string> = {
              __helena_readiness: uncertain ? 'uncertain' : 'ready',
              simple: 'command',
              action,
              confirmation: 'done',
              t1: 'skip',
            };
            const choice = choices[id] ?? options[0]!;
            return [
              id,
              {
                type: 'choice',
                choice,
                confidence: 0.999,
                probabilities: Object.fromEntries(
                  options.map((option) => [
                    option,
                    option === choice ? 0.999 : 0.001 / (options.length - 1),
                  ]),
                ),
              },
            ];
          }),
        ),
      });
    },
  });
});
afterAll(() => server.stop(true));
beforeEach(async () => {
  await resetDb();
  uncertain = false;
  calls = 0;
  decisionDelayMs = 0;
});

async function setup(classId = AVA_COMMAND_CLASS) {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'AVA', name: 'Synthetic Ava' })).data!;
  const agent = (
    await createAgent(api, 'AVA', {
      name: 'Ava fixture',
      username: 'ava-fixture',
      kind: 'external',
    })
  ).data!;
  const credential = await api.teams({ teamId: project.teamId }).credentials.post({
    kind: 'decision_model',
    label: 'Synthetic Jev',
    provider: 'typesafe',
    baseUrl: `http://127.0.0.1:${server.port}`,
    allowPrivateAddress: true,
    model: 'jev-synthetic',
    value: 'synthetic-key',
  });
  expect(credential.status).toBe(201);
  const credentialId = credential.data!.id;
  await db.insert(helenaDecisionEval).values({
    teamId: project.teamId,
    classId,
    credentialId,
    backendLabel: 'fixture',
    threshold: 0.98,
    questions: 10,
    answered: 10,
    correct: 10,
    correctAnswered: 10,
    precision: 1,
    coverage: 1,
    accuracy: 1,
    passed: true,
    finishedAt: new Date(),
  });
  expect(
    (
      await api
        .teams({ teamId: project.teamId })
        .decisions.classes({ classId })
        .patch({ enabled: true, credentialId, threshold: 0.98 })
    ).status,
  ).toBe(200);
  expect(
    (
      await api.teams({ teamId: project.teamId }).decisions['first-stage'].patch({
        credentialId,
        useCases: { [classId]: { enabled: true, cloudAllowed: true } },
      })
    ).status,
  ).toBe(200);
  expect(
    (await api.teams({ teamId: project.teamId }).decisions['first-stage'].patch({ enabled: true }))
      .status,
  ).toBe(200);
  const board = (await api.projects({ projectKey: 'AVA' }).get()).data!;
  return { api, project, agentId: agent.agent.id, column: board.columns[0]! };
}

test('a spoken command creates exactly one task through the existing guarded tool', async () => {
  const { api, agentId, column } = await setup();
  decisionDelayMs = 100;
  const sent = await api
    .projects({ projectKey: 'AVA' })
    ['ai-agents']({ agentId })
    .chat.post({
      prompt: `Ava, lege eine Aufgabe "Budget prüfen" in "${column.name}" an`,
      via: 'voice',
    });
  expect(sent.status).toBe(200);
  expect((await api.projects({ projectKey: 'AVA' }).issues.get()).data).toHaveLength(0);
  const thread = api
    .projects({ projectKey: 'AVA' })
    ['ai-agents']({ agentId })
    .threads({ threadId: sent.data!.threadId });
  let done = false;
  for (let i = 0; i < 200; i++) {
    const messages = (await thread.messages.get()).data!.items;
    done = messages.some((message) => message.role === 'assistant' && message.durationMs != null);
    if (done) break;
    await Bun.sleep(10);
  }
  expect(done).toBe(true);
  const tasks = await api.projects({ projectKey: 'AVA' }).issues.get();
  expect(tasks.data?.map((task) => task.title)).toEqual(['Budget prüfen']);
  expect(calls).toBeGreaterThanOrEqual(3);
});

test('uncertainty, negation and a destructive request create no task', async () => {
  for (const mode of ['uncertain', 'negated', 'destructive']) {
    await resetDb();
    const { api, agentId, column } = await setup();
    uncertain = mode === 'uncertain';
    const command = `lege eine Aufgabe "Budget prüfen" in "${column.name}" an`;
    const sent = await api
      .projects({ projectKey: 'AVA' })
      ['ai-agents']({ agentId })
      .chat.post({
        prompt:
          mode === 'negated'
            ? `Führe nicht aus: ${command}`
            : mode === 'destructive'
              ? 'lösche alle Aufgaben'
              : command,
      });
    expect(sent.status).toBe(200);
    expect((await api.projects({ projectKey: 'AVA' }).issues.get()).data).toEqual([]);
  }
});

test('ambiguous status names never choose an arbitrary column', async () => {
  const { api, agentId, column } = await setup();
  expect(
    (
      await api
        .projects({ projectKey: 'AVA' })
        .columns.post({ name: column.name, stateType: 'unstarted' })
    ).status,
  ).toBe(201);
  await api
    .projects({ projectKey: 'AVA' })
    ['ai-agents']({ agentId })
    .chat.post({ prompt: `lege eine Aufgabe "Budget prüfen" in "${column.name}" an` });
  expect((await api.projects({ projectKey: 'AVA' }).issues.get()).data).toEqual([]);
});

test('the selection endpoint returns only relevant submitted tools and refuses foreign chats', async () => {
  const { api } = await setup(TOOL_SELECTION_CLASS);
  const body = {
    projectKey: 'AVA',
    prompt: 'Read a file.',
    tools: [
      { name: 'read_file', description: 'Read a file.' },
      { name: 'send_mail', description: 'Send mail.' },
    ],
  };
  const selected = await api.decisions['tool-selection'].post(body);
  expect(selected.data).toEqual({ names: ['read_file'] });
  expect(
    (await api.decisions['tool-selection'].post({ ...body, chatMessageId: 12345 })).status,
  ).toBe(403);
});
