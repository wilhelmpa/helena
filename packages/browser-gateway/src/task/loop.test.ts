import { describe, expect, it } from 'bun:test';
import { contactSite } from './fake-site';
import { readOnlyPage, runTask, repeatsBlock, TaskActError, type TaskDeps } from './loop';
import type { DecisionPolicy } from './policy';
import { mockAnswers } from './mock-backend';
import { jevPolicy, jevRound } from './policy-jev';
import { layaPolicy, layaRound } from './policy-laya';
import { replyOf, type DecisionClient, type DecisionRequest } from './systemone';
import type { TaskInput } from './types';

const mock: DecisionClient = {
  async decide(request: DecisionRequest) {
    return replyOf(mockAnswers({ ...request, model: 'jev-latest' } as never), 3);
  },
};

// A client that answers one scripted reply per call (then the mock).
function scripted(
  replies: ((request: DecisionRequest) => Record<string, unknown> | null)[],
): DecisionClient & {
  requests: DecisionRequest[];
} {
  const requests: DecisionRequest[] = [];
  return {
    requests,
    async decide(request) {
      requests.push(request);
      const next = replies.shift();
      const answers = next?.(request);
      if (!answers) return replyOf(mockAnswers({ ...request, model: 'jev-latest' } as never), 3);
      const base = mockAnswers({ ...request, model: 'jev-latest' } as never);
      return replyOf({ ...base, answers: { ...base.answers, ...answers } }, 3);
    },
  };
}

function deps(
  site = contactSite(),
  overrides: Partial<TaskDeps> = {},
): TaskDeps & { decisions: string[] } {
  const decisions: string[] = [];
  return {
    decisions,
    page: site,
    client: mock,
    policy: jevPolicy,
    authorize: async ({ category }) => {
      decisions.push(category);
      return { effect: 'allow' };
    },
    holdsControl: () => true,
    sleep: async () => {},
    ...overrides,
  };
}

const contact: TaskInput = {
  goal: 'Öffne Kontakt, fülle das Formular mit Name und E-Mail aus und sende es ab',
  values: { name: 'Ada Lovelace', email: 'ada@example.com' },
  mode: 'act',
  maxSteps: 20,
  allowIrreversible: false,
  success: { url: 'https://site.test/danke' },
};

describe('runTask with the Jev policy', () => {
  it('navigates, fills the form from values, submits and reports done', async () => {
    const site = contactSite();
    const d = deps(site);
    const result = await runTask(contact, d);
    expect(result.status).toBe('done');
    expect(site.url).toBe('/danke');
    const ops = result.steps.map((step) => step.operation);
    expect(ops[0]).toBe('CLICK');
    expect(ops.filter((op) => op === 'TYPE_TEXT')).toHaveLength(2);
    // The submit is decided as a send, exactly like browser_click on a submit button.
    expect(d.decisions).toContain('send');
    // Steps name the value keys, never the values.
    expect(JSON.stringify(result.steps)).not.toContain('ada@example.com');
    expect(result.steps.find((step) => step.operation === 'TYPE_TEXT')?.valueKey).toBeDefined();
    expect(result.usage.calls).toBeGreaterThan(0);
    expect(result.usage.model).toBe('mock-1');
  });

  it('never sends the typed values in the history to the backend', async () => {
    const client = scripted([]);
    await runTask(contact, deps(contactSite(), { client }));
    const histories = client.requests.map((request) =>
      JSON.stringify((request.state as { task?: { history?: unknown } }).task?.history ?? []),
    );
    for (const history of histories) expect(history).not.toContain('Ada Lovelace');
  });

  it('stops before an approval-needing action and names the card', async () => {
    const site = contactSite();
    const result = await runTask(
      contact,
      deps(site, {
        authorize: async ({ category }) =>
          category === 'send'
            ? { effect: 'needs-approval', reason: 'level 1', approvalId: 42 }
            : { effect: 'allow' },
      }),
    );
    expect(result.status).toBe('needs_approval');
    expect(result.approvalId).toBe(42);
    expect(result.pending?.category).toBe('send');
    expect(site.url).toBe('/kontakt');
  });

  it('stops when the policy denies an action', async () => {
    const result = await runTask(
      contact,
      deps(contactSite(), { authorize: async () => ({ effect: 'deny', reason: 'no' }) }),
    );
    expect(result.status).toBe('denied');
  });

  it('stops before the next action once the owner takes over', async () => {
    let calls = 0;
    const result = await runTask(contact, deps(contactSite(), { holdsControl: () => ++calls < 3 }));
    expect(result.status).toBe('owner_took_over');
  });

  it('pauses before an action that looks irreversible unless allowed', async () => {
    const client = scripted([() => ({ irreversible: { type: 'noul', noul: 0.9 } })]);
    const result = await runTask(contact, deps(contactSite(), { client }));
    expect(result.status).toBe('needs_confirmation');
    expect(result.pending?.operation).toBe('CLICK');
  });

  it('hands back when the target is ambiguous, with candidates', async () => {
    const site = contactSite();
    site.pages['/']!.controls.push(
      { role: 'link', label: 'Impressum', href: '/about' },
      { role: 'link', label: 'Datenschutz', href: '/about' },
    );
    const client = scripted([
      (request) => {
        const keys = Object.keys((request.questions.click_target as { criteria: object }).criteria);
        return {
          operation: {
            type: 'choice',
            choice: 'CLICK',
            probabilities: { CLICK: 1, WAIT: 0, DONE: 0, BLOCKED: 0 },
            confidence: 1,
          },
          click_target: {
            type: 'choice',
            choice: keys[0],
            probabilities: Object.fromEntries(keys.map((k) => [k, 1 / keys.length])),
            confidence: 0.1,
          },
        };
      },
    ]);
    const result = await runTask(contact, deps(site, { client }));
    expect(result.status).toBe('needs_agent');
    expect(result.candidates?.length).toBeGreaterThan(0);
  });

  it('asks for text it was not given instead of inventing it', async () => {
    const site = contactSite();
    site.url = '/kontakt';
    const result = await runTask({ ...contact, values: {} }, deps(site));
    // Without values TYPE_TEXT is not even offered; the mock clicks Senden, which fails.
    expect(['error', 'stuck', 'needs_agent', 'likely_done', 'max_steps']).toContain(result.status);
    expect(site.actions.some((action) => action.operation === 'TYPE_TEXT')).toBe(false);
  });

  it('re-observes when the page changed under a decision', async () => {
    const site = contactSite();
    site.staleOnce = true;
    const result = await runTask(contact, deps(site));
    expect(result.status).toBe('done');
  });

  it('stops at a page dialog', async () => {
    const site = contactSite();
    site.dialog = 'confirm: Wirklich?';
    const result = await runTask(contact, deps(site));
    expect(result.status).toBe('needs_agent');
    expect(result.summary).toContain('browser_handle_dialog');
  });

  it('reports a backend failure without acting', async () => {
    const site = contactSite();
    const result = await runTask(
      contact,
      deps(site, {
        client: {
          decide: async () => {
            throw new Error('HTTP 401');
          },
        },
      }),
    );
    expect(result.status).toBe('backend_error');
    expect(site.actions).toHaveLength(0);
  });

  it('refuses an invalid answer (a choice that was not offered)', async () => {
    const site = contactSite();
    const client = scripted([
      () => ({
        operation: { type: 'choice', choice: 'FLY', probabilities: { FLY: 1 }, confidence: 1 },
      }),
    ]);
    const result = await runTask(contact, deps(site, { client }));
    expect(result.status).toBe('backend_error');
    expect(site.actions).toHaveLength(0);
  });

  it.each([undefined, null, NaN, Infinity, -0.1, 1.1])(
    'does not act when the backend gives invalid confidence (%s)',
    async (confidence) => {
      const site = contactSite();
      const client = scripted([
        (request) => ({
          operation: {
            ...(mockAnswers({ ...request, model: 'jev-latest' } as never).answers
              .operation as Record<string, unknown>),
            confidence,
          },
        }),
      ]);
      const d = deps(site, { client });
      const result = await runTask(contact, d);
      expect(result.status).toBe('backend_error');
      expect(result.summary).toContain('confidence');
      expect(site.actions).toHaveLength(0);
      expect(d.decisions).toHaveLength(0);
    },
  );

  it('keeps to the step budget', async () => {
    const result = await runTask({ ...contact, maxSteps: 2 }, deps());
    expect(result.status).toBe('max_steps');
    expect(result.steps.length).toBeLessThanOrEqual(2);
  });

  it('in read mode only offers looking around', async () => {
    const site = contactSite();
    site.url = '/kontakt';
    const round = jevRound({
      observation: await site.observe(),
      goal: 'Lies das Formular',
      values: {},
      mode: 'read',
      round: 0,
      history: [],
      excluded: new Set(),
    });
    expect(round.ops).not.toContain('TYPE_TEXT');
    expect(round.ops).not.toContain('SELECT');
    expect(round.ops).not.toContain('CLICK');
    expect(round.ops).not.toContain('PRESS_ENTER');
    expect(round.targets.CLICK).toHaveLength(0);
    expect(round.request.questions.irreversible).toBeUndefined();
    const laya = layaRound({
      observation: await site.observe(),
      goal: 'nichts anklicken, nur lesen',
      values: {},
      mode: 'read',
      round: 0,
      history: [],
      excluded: new Set(),
    });
    expect(laya.targets.CLICK).toHaveLength(0);
    expect(laya.targets.TYPE_TEXT).toHaveLength(0);
  });

  // Found live 2026-09-25: Browser 2.0, mode read, goal "nichts anklicken", Laya clicked twice.
  it('in read mode never carries out a write, whatever the policy answers', async () => {
    const site = contactSite();
    const observation = await site.observe();
    const link = observation.elements.find((element) => element.href) ?? observation.elements[0]!;
    // A policy that ignores what it was offered and always clicks.
    const clicky: DecisionPolicy = {
      ...layaPolicy,
      async round() {
        return {
          operation: 'CLICK',
          element: link,
          operationProbability: 0.99,
          operationConfidence: 0.99,
          targetProbability: 0.99,
          done: null,
          error: null,
          login: null,
          blocked: null,
          irreversible: null,
          candidates: [],
        };
      },
    };
    const d = deps(site, { policy: clicky });
    const result = await runTask(
      {
        goal: 'Lies die Seite, nichts anklicken',
        values: {},
        mode: 'read',
        maxSteps: 5,
        allowIrreversible: false,
      },
      d,
    );
    expect(result.status).toBe('denied');
    expect(result.pending?.category).toBe('write');
    expect(site.actions).toHaveLength(0);
    expect(d.decisions).toHaveLength(0);
    expect(result.steps).toHaveLength(0);
  });

  it("the gateway's read-only page refuses everything but scrolling and waiting", async () => {
    const site = contactSite();
    const page = readOnlyPage(site);
    const observation = await page.observe();
    const element = observation.elements[0]!;
    for (const operation of ['CLICK', 'TYPE_TEXT', 'SELECT', 'PRESS_ENTER'] as const) {
      const refused = await page
        .act({ operation, element, text: 'x', option: 'y', observation })
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(refused).toBeInstanceOf(TaskActError);
      expect((refused as TaskActError).code).toBe('refused');
    }
    expect(site.actions).toHaveLength(0);
    await page.act({ operation: 'SCROLL_DOWN', element: null, observation });
    expect(site.actions.map((action) => action.operation)).toEqual(['SCROLL_DOWN']);
  });

  it('does not click a checkbox that is already checked', async () => {
    const site = contactSite();
    site.pages['/'] = {
      title: 'Terms',
      text: 'Bitte zustimmen',
      controls: [
        { role: 'checkbox', label: 'AGB akzeptiert', checked: true },
        { role: 'link', label: 'Weiter zu Kontakt', href: '/kontakt' },
      ],
    };
    const client = scripted([
      () => ({
        operation: {
          type: 'choice',
          choice: 'CLICK',
          probabilities: { CLICK: 1, WAIT: 0, DONE: 0, BLOCKED: 0 },
          confidence: 1,
        },
        click_target: {
          type: 'choice',
          choice: '1',
          probabilities: { '1': 0.9, '2': 0.1 },
          confidence: 0.9,
        },
      }),
    ]);
    await runTask(
      { ...contact, goal: 'Stimme den AGB zu und öffne Kontakt' },
      deps(site, { client }),
    );
    expect(site.actions.some((action) => action.element?.i === 1)).toBe(false);
  });
});

describe('runTask with the Laya policy', () => {
  it('sends the jev-ultrafast format the browser checkpoint was trained on', async () => {
    const site = contactSite();
    site.url = '/kontakt';
    const round = layaRound({
      observation: await site.observe(),
      goal: contact.goal,
      values: contact.values,
      mode: 'act',
      round: 0,
      history: [
        {
          action: 'type_text',
          element: 'textbox "Name"',
          value: 'name',
          text: 'Ada Lovelace',
          page_changed: true,
        },
      ],
      excluded: new Set(),
    });
    const state = round.request.state as {
      page: { text: string };
      recent_actions: { text: string }[];
    };
    expect(Object.keys(round.request.questions)).toEqual(
      expect.arrayContaining(['operation', 'click_target', 'type_text_target']),
    );
    const click = round.request.questions.click_target as {
      criteria: Record<string, { element: string }>;
    };
    expect(Object.values(click.criteria)[0]!.element).toMatch(/^\[\d+\] /);
    // Dropdown options are targets of their own ("i:k").
    const select = round.request.questions.select_target;
    expect(
      select === undefined ||
        Object.keys((select as { criteria: object }).criteria).every((k) => /^\d+:\d+$/.test(k)),
    ).toBe(true);
    // A local model gets the typed text in its history (it never leaves the machine).
    expect(state.recent_actions[0]!.text).toBe('Ada Lovelace');
    expect(state.page.text.length).toBeLessThanOrEqual(1200);
  });

  it('completes the contact task on the mock', async () => {
    const site = contactSite();
    const result = await runTask(contact, deps(site, { policy: layaPolicy }));
    expect(['done', 'likely_done']).toContain(result.status);
    expect(site.url).toBe('/danke');
  });
});

describe('repeatsBlock', () => {
  it('finds a repeated pair', () => {
    expect(repeatsBlock(['a', 'b', 'a', 'b', 'a', 'b'], 2, 3)).toBe(true);
    expect(repeatsBlock(['a', 'b', 'a', 'c', 'a', 'b'], 2, 3)).toBe(false);
  });
});

describe('bounded execution and independent completion', () => {
  it('legacy callers terminate as likely_done with page evidence', async () => {
    const result = await runTask({ ...contact, success: undefined }, deps());
    expect(result.status).toBe('likely_done');
    expect(result.pageText).toBeDefined();
    expect(result.steps.length).toBeLessThan(contact.maxSteps);
  });

  it('a model completion claim cannot bypass fresh success criteria', async () => {
    const site = contactSite();
    const client = scripted([() => ({ done: { noul: 0.99 } })]);
    const result = await runTask(contact, deps(site, { client }));
    expect(result.status).toBe('needs_agent');
    expect(site.actions).toHaveLength(0);
  });

  it('discards a decision when the page changes during authorization', async () => {
    const site = contactSite();
    let first = true;
    const result = await runTask(
      contact,
      deps(site, {
        authorize: async () => {
          if (first) {
            first = false;
            site.url = '/kontakt';
          }
          return { effect: 'allow' };
        },
      }),
    );
    expect(result.status).toBe('done');
    expect(site.actions[0]?.operation).toBe('TYPE_TEXT');
  });

  it('records an uncertain mutation and never retries it', async () => {
    const site = contactSite();
    const original = site.act.bind(site);
    site.act = async (input) => {
      await original(input);
      throw new Error('timed out after input');
    };
    const result = await runTask(contact, deps(site));
    expect(result.status).toBe('needs_agent');
    expect(site.actions).toHaveLength(1);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.outcome).toContain('unknown');
  });

  it('preserves executed steps if the next observation fails', async () => {
    const site = contactSite();
    const original = site.observe.bind(site);
    let reads = 0;
    site.observe = async () => {
      if (++reads > 1) throw new Error('detached');
      return original();
    };
    const result = await runTask(contact, deps(site));
    expect(result.status).toBe('needs_agent');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.outcome).toBe('done');
    expect(site.actions).toHaveLength(1);
  });

  it('bounds WAIT and observes after every wait', async () => {
    const site = contactSite();
    const original = site.observe.bind(site);
    let reads = 0;
    site.observe = async () => {
      reads++;
      return original();
    };
    const result = await runTask(
      contact,
      deps(site, {
        policy: {
          ...jevPolicy,
          round: async () => ({
            operation: 'WAIT',
            element: null,
            operationProbability: 1,
            operationConfidence: 1,
            targetProbability: 1,
            done: 0,
            error: null,
            login: null,
            blocked: null,
            irreversible: null,
            candidates: [],
          }),
        },
      }),
    );
    expect(result.status).toBe('stuck');
    expect(result.steps).toHaveLength(6);
    expect(reads).toBe(7);
    expect(site.actions).toHaveLength(0);
  });
});
