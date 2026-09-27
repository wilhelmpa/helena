import { expect, it } from 'bun:test';
import { HelenaApiError } from '../helena-client';
import { formatTaskResult, runTaskTool, type TaskContext } from './run';
import { contactSite } from './fake-site';
import { mockAnswers } from './mock-backend';
import type { DecisionRequest } from './systemone';
import type { TaskResult } from './types';

it('hands legacy callers an unverified terminal status and continuation snapshot', () => {
  const result: TaskResult = {
    status: 'likely_done',
    summary: 'Verify the outcome.',
    url: 'https://site.test/',
    title: 'Test',
    steps: [],
    usage: { calls: 1, inputTokens: 1, outputTokens: 1, decisionMs: 1, model: 'test' },
    durationMs: 1,
    confidence: 1,
    doneScore: 1,
  };
  const text = formatTaskResult(
    result,
    { label: 'Jev', model: 'test' },
    'Visible result to inspect',
  );
  expect(text).toContain('Status: likely_done');
  expect(text).toContain('Visible result to inspect');
});

for (const failure of ['provider', 'timeout', 'unreachable', 'ambiguous'] as const) {
  it(`hands ${failure} back through the public task caller with the original task scope`, async () => {
    const site = contactSite();
    let started: Record<string, unknown> | undefined;
    let finished: { taskToken: string; result: TaskResult } | undefined;
    const decisionTokens: string[] = [];
    let authorizationCalls = 0;
    let snapshots = 0;
    const context = {
      request: {
        tool: 'browser_task',
        args: { goal: 'Open the requested contact page', mode: 'act', maxSteps: 1 },
        agentKey: 'synthetic-agent',
        runId: 71,
        messageId: 81,
      },
      slug: 'synthetic-project',
      via: 'agent',
      holdsControl: () => true,
      session: {
        taskPage: () => site,
        agentSnapshot: async () => {
          snapshots++;
          return '- link "Kontakt" [ref=synthetic-contact]';
        },
      },
      helena: {
        taskStart: async (request: Record<string, unknown>) => {
          started = request;
          return {
            taskId: 91,
            taskToken: 'synthetic-task-token',
            policy: 'jev',
            minConfidence: 0.95,
            label: 'Jev',
            model: 'synthetic-decision-model',
          };
        },
        systemOne: async (request: DecisionRequest & { taskToken: string }) => {
          decisionTokens.push(request.taskToken);
          if (failure === 'provider') throw new HelenaApiError(402, 'Synthetic provider failure');
          if (failure === 'timeout') throw new HelenaApiError(504, 'Synthetic timeout response');
          if (failure === 'unreachable') throw new Error('Synthetic transport failure');
          const keys = Object.keys(
            (request.questions.click_target as { criteria: object }).criteria,
          );
          return {
            ...mockAnswers(request),
            answers: {
              ...mockAnswers(request).answers,
              operation: {
                type: 'choice',
                choice: 'CLICK',
                probabilities: { CLICK: 1, WAIT: 0, DONE: 0, BLOCKED: 0 },
                confidence: 1,
              },
              click_target: {
                type: 'choice',
                choice: keys[0],
                probabilities: Object.fromEntries(keys.map((key) => [key, 1 / keys.length])),
                confidence: 0.1,
              },
            },
          };
        },
        decide: async () => {
          authorizationCalls++;
          return { effect: 'allow' };
        },
        taskProgress: async () => ({ cancelled: false }),
        taskFinish: async (request: { taskToken: string; result: TaskResult }) => {
          finished = request;
        },
      },
    } as unknown as TaskContext;
    const result = await runTaskTool(context);
    expect(started).toMatchObject({
      agentKey: 'synthetic-agent',
      projectSlug: 'synthetic-project',
      via: 'agent',
      runId: 71,
      messageId: 81,
      kind: 'task',
      mode: 'act',
      maxSteps: 1,
      startUrl: null,
    });
    expect(decisionTokens).toEqual(['synthetic-task-token']);
    expect(finished?.taskToken).toBe('synthetic-task-token');
    expect(finished?.result.status).toBe(failure === 'ambiguous' ? 'needs_agent' : 'backend_error');
    expect(site.actions).toEqual([]);
    expect(authorizationCalls).toBe(0);
    expect(snapshots).toBe(1);
    expect(result.text).toContain('Continue with the step tools on these refs:');
    expect(result.text).toContain('[ref=synthetic-contact]');
    if (failure === 'ambiguous') expect(finished?.result.candidates?.length).toBeGreaterThan(0);
  });
}

it('the public task caller preserves verified and legacy terminal results through taskFinish', async () => {
  for (const verify of [false, true]) {
    const site = contactSite();
    let finished: TaskResult | undefined;
    let snapshots = 0;
    const context = {
      request: {
        args: {
          goal: 'Öffne Kontakt, fülle das Formular mit Name und E-Mail aus und sende es ab',
          values: { name: 'Ada', email: 'ada@example.test' },
          ...(verify ? { success: { url: 'https://site.test/danke' } } : {}),
        },
        agentKey: 'synthetic-test',
      },
      slug: 'alpha',
      via: 'test',
      holdsControl: () => true,
      session: {
        taskPage: () => site,
        agentSnapshot: async () => {
          snapshots++;
          return 'Synthetic current page';
        },
      },
      helena: {
        taskStart: async () => ({
          taskId: 1,
          taskToken: 'synthetic-test',
          policy: 'jev',
          minConfidence: null,
          label: 'Jev',
          model: 'test',
        }),
        systemOne: async (request: DecisionRequest) => ({
          answers: mockAnswers(request).answers,
          model: 'test',
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
        }),
        decide: async () => ({ effect: 'allow' }),
        taskProgress: async () => ({ cancelled: false }),
        taskFinish: async ({ result }: { result: TaskResult }) => {
          finished = result;
        },
      },
    } as unknown as TaskContext;
    const result = await runTaskTool(context);
    expect(finished?.status).toBe(verify ? 'done' : 'likely_done');
    expect(result.text).toContain(`Status: ${verify ? 'done' : 'likely_done'}`);
    expect(snapshots).toBe(verify ? 0 : 1);
  }
});

for (const boundary of [
  'provider-after-click',
  'off-after-step',
  'off-at-completion',
  'held-progress',
  'held-final-progress',
  'held-finish',
] as const) {
  it(`keeps applied actions and current page evidence on ${boundary} without starting again`, async () => {
    const site = contactSite();
    let starts = 0;
    let finished: TaskResult | undefined;
    const authorized: string[] = [];
    let heldSignal: AbortSignal | undefined;
    const failsAfterClick = ['provider-after-click', 'held-progress', 'held-finish'].includes(
      boundary,
    );
    const context = {
      request: {
        tool: 'browser_task',
        agentKey: 'synthetic-agent',
        runId: 17,
        messageId: 18,
        args: {
          goal: 'Öffne Kontakt, fülle das Formular mit Name und E-Mail aus und sende es ab',
          values: { name: 'Ada', email: 'ada@example.test' },
          success: { url: 'https://site.test/danke' },
        },
      },
      slug: 'synthetic-project',
      via: 'test',
      holdsControl: () => true,
      session: {
        taskPage: () => site,
        agentSnapshot: async () =>
          `Current synthetic page: ${site.url}; already applied: ${site.actions.length}`,
      },
      helena: {
        taskStart: async () => {
          starts++;
          return {
            taskId: 19,
            taskToken: 'synthetic-bound-token',
            policy: 'jev',
            minConfidence: null,
            label: 'Jev',
            model: 'test',
          };
        },
        systemOne: async (request: DecisionRequest) => {
          if (failsAfterClick && site.actions.length > 0)
            throw new HelenaApiError(
              409,
              'The optional stage stopped. Continue on the current page.',
            );
          return {
            answers: mockAnswers(request).answers,
            model: 'test',
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 0,
          };
        },
        decide: async (input: { taskToken: string }) => {
          authorized.push(input.taskToken);
          return { effect: 'allow' };
        },
        taskProgress: async ({ step }: { step: unknown }, signal?: AbortSignal) => {
          if (
            boundary === 'held-progress' ||
            (boundary === 'held-final-progress' && step === null)
          ) {
            heldSignal = signal;
            return new Promise<never>(() => {});
          }
          return {
            cancelled:
              boundary === 'off-after-step'
                ? site.actions.length > 0
                : boundary === 'off-at-completion' && step === null,
          };
        },
        taskFinish: async ({ result }: { result: TaskResult }, signal?: AbortSignal) => {
          finished = result;
          if (boundary === 'held-finish') {
            heldSignal = signal;
            return new Promise<never>(() => {});
          }
        },
      },
    } as unknown as TaskContext;
    const started = Date.now();
    const output = await runTaskTool(context);
    if (boundary.startsWith('held-')) {
      expect(Date.now() - started).toBeLessThan(1800);
      expect(heldSignal?.aborted).toBe(true);
    }
    expect(starts).toBe(1);
    expect(site.actions.length).toBeGreaterThan(0);
    expect(authorized.every((token) => token === 'synthetic-bound-token')).toBe(true);
    expect(finished?.status).toBe(failsAfterClick ? 'backend_error' : 'cancelled');
    expect(finished?.steps.length).toBe(site.actions.length);
    expect(output.text).toContain(
      `Current synthetic page: ${site.url}; already applied: ${site.actions.length}`,
    );
    expect(output.text).toContain('Continue with the step tools on these refs:');
    if (['off-at-completion', 'held-final-progress'].includes(boundary))
      expect(site.url).toBe('/danke');
    else {
      expect(site.actions).toHaveLength(1);
      expect(site.url).toBe('/kontakt');
    }
  });
}
