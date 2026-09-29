import { describe, expect, it } from 'bun:test';
import { contactSite } from './fake-site';
import { jevPolicy, jevRound } from './policy-jev';
import { NEXT_ACTION, TARGET } from './policy-common';
import type { RoundInput } from './policy';
import { replyOf, type DecisionRequest } from './systemone';

function reply(
  request: DecisionRequest,
  chosen: Record<string, string> = {},
  overrides: Record<string, unknown> = {},
) {
  return replyOf(
    {
      answers: Object.fromEntries(
        Object.entries(request.questions).map(([id, q]) => {
          if (id in overrides) return [id, overrides[id]];
          if (q.type === 'noul') return [id, { noul: 0.01 }];
          if (q.type !== 'choice') throw new Error('unexpected question');
          const keys = Object.keys(q.criteria);
          const choice = chosen[id] ?? keys[0]!;
          return [
            id,
            {
              type: 'choice',
              choice,
              confidence: 1,
              probabilities: Object.fromEntries(keys.map((key) => [key, key === choice ? 1 : 0])),
            },
          ];
        }),
      ),
    },
    1,
  );
}

async function input(): Promise<RoundInput> {
  const observation = await contactSite().observe();
  observation.elements.push({
    i: 20,
    id: 20,
    frame: 0,
    tag: 'select',
    role: 'combobox',
    label: 'Plan',
    selectable: true,
    options: ['Choose', 'Standard', 'Standard'],
    optionIndices: [0, 2, 5],
    selectedIndex: 0,
    value: 'choose',
  });
  return {
    observation,
    goal: 'Choose the last Standard plan',
    values: { name: 'Ada', query: 'Standard' },
    mode: 'act',
    round: 0,
    history: [],
    excluded: new Set(),
  };
}

describe('compatible speculative Jev heads', () => {
  it('bounds page metadata and history while preserving the complete allowed goal', async () => {
    const state = await input();
    state.observation.title = 'x'.repeat(100_000);
    state.observation.url = `https://example.invalid/${'x'.repeat(100_000)}`;
    state.history = [{ action: 'click', element: 'x'.repeat(100_000) }];
    state.goal = 'x'.repeat(1500);
    const request = jevRound(state).request;
    expect(JSON.stringify(request.state).length).toBeLessThan(8000);
    expect((request.state as { task: { goal: string } }).task.goal).toBe(state.goal);
    state.goal += ' Do not submit.';
    expect(() => jevRound(state)).toThrow('complete goal');
  });
  it('caps the state at forty visible candidates and four history entries', async () => {
    const state = await input();
    state.observation.text = 'x'.repeat(5000);
    state.history = Array.from({ length: 10 }, (_, i) => ({ action: `action-${i}` }));
    state.observation.elements.push(
      ...Array.from({ length: 100 }, (_, i) => ({
        i: i + 30,
        id: i + 30,
        frame: 0,
        tag: 'button',
        role: 'button',
        text: `Choice ${i}`,
        ...(i === 99 ? { offscreen: true } : {}),
      })),
    );
    const request = jevRound(state).request;
    const wire = request.state as {
      page: { text: string; elements: { i: number }[] };
      task: { history: unknown[] };
    };
    expect(wire.page.text.length).toBe(1800);
    expect(wire.page.elements.length).toBeLessThanOrEqual(40);
    expect(JSON.stringify(request.state).length).toBeLessThan(8000);
    expect(wire.page.elements.some((e) => e.i === 129)).toBe(false);
    expect(wire.task.history).toHaveLength(4);
  });
  it('selects an observed native option in one request, including duplicate labels', async () => {
    const state = await input();
    let calls = 0;
    const result = await jevPolicy.round(state, async (request) => {
      calls++;
      const question = request.questions.select_target!;
      expect(question).toMatchObject({
        criteria: {
          '20:2': { element: 20, option: 'Standard' },
          '20:5': { element: 20, option: 'Standard' },
        },
      });
      expect(question.instructions).toMatchObject({ rules: [NEXT_ACTION, TARGET] });
      return reply(
        request,
        { operation: 'SELECT', select_target: '20:5' },
        { value: { malformed: true } },
      );
    });
    expect(calls).toBe(1);
    expect(result.element?.i).toBe(20);
    expect(result.option).toBe('Standard');
    expect(result.optionIndex).toBe(5);
  });

  it('uses a sole supplied text value without a one-option question', async () => {
    const state = await input();
    state.values = { name: 'Ada' };
    state.observation.elements.push({
      i: 21,
      id: 21,
      frame: 0,
      tag: 'input:text',
      role: 'textbox',
      label: 'Name',
      editable: true,
    });
    const result = await jevPolicy.round(state, async (request) => {
      expect(request.questions.value).toBeUndefined();
      return reply(request, { operation: 'TYPE_TEXT' });
    });
    expect(result.valueKey).toBe('name');
  });

  it('ignores malformed unused heads but rejects a malformed selected head', async () => {
    const state = await input();
    const clicked = await jevPolicy.round(state, async (request) =>
      reply(request, { operation: 'CLICK' }, { value: {}, select_target: {} }),
    );
    expect(clicked.operation).toBe('CLICK');
    await expect(
      jevPolicy.round(state, async (request) =>
        reply(request, { operation: 'SELECT' }, { select_target: {} }),
      ),
    ).rejects.toThrow();
  });

  it('does not offer SELECT when every observed option is already selected', async () => {
    const state = await input();
    const select = state.observation.elements.find((e) => e.i === 20)!;
    select.options = ['Only'];
    select.optionIndices = [3];
    select.selectedIndex = 3;
    expect(jevRound(state).ops).not.toContain('SELECT');
  });
});
