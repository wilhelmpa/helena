import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import teams from '../../../../../messages/en/teams.json';
import { runtimeOptions } from '@/components/helena/RuntimePicker';
import type { HelenaRuntimeSettings } from '@/lib/api/endpoints/agents';

// The settings of Helena's own loop in the agent editor: the hand-over's task kinds, the
// failure switch, the confidence threshold and the browser time reach the agent's policy.

const { default: AgentHelenaRuntimeFields } = await import('./AgentHelenaRuntimeFields');

test('offers Helena’s own loop only where the instance switched it on', () => {
  assert.equal(
    runtimeOptions({ runtime: 'hermes', external: true, helena: false }).includes('helena'),
    false,
  );
  assert.equal(
    runtimeOptions({ runtime: 'hermes', external: true, helena: true }).includes('helena'),
    true,
  );
  // An agent already on it keeps it selectable.
  assert.equal(
    runtimeOptions({ runtime: 'helena', external: false, helena: false }).includes('helena'),
    true,
  );
});

test('the hand-over settings reach the policy', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const saved = new Map(
    [
      'window',
      'document',
      'navigator',
      'HTMLFormElement',
      'HTMLElement',
      'Element',
      'IS_REACT_ACT_ENVIRONMENT',
    ].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  for (const name of saved.keys())
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value:
        name === 'IS_REACT_ACT_ENVIRONMENT'
          ? true
          : (dom.window as unknown as Record<string, unknown>)[name],
    });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.querySelector('#root')!);
  let value: HelenaRuntimeSettings = {
    toolProfile: 'recherche',
    escalation: { target: 'runtime:claude' },
  };
  const render = () =>
    act(async () =>
      root.render(
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ teams }}>
          <AgentHelenaRuntimeFields
            value={value}
            onChange={(next) => {
              value = next;
              void render();
            }}
          />
        </NextIntlClientProvider>,
      ),
    );
  const type = async (input: HTMLInputElement, text: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      setter.call(input, text);
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  };
  try {
    await render();
    assert.match(
      document.body.textContent ?? '',
      /Like Assistant, plus the project browser directly/,
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[role="switch"][aria-label="Legal and contracts"]')!
        .click(),
    );
    assert.deepEqual(value.escalation?.taskKinds, ['recht']);
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[role="switch"][aria-label="Hand over after a failure (loop, red tests, time limit)"]',
        )!
        .click(),
    );
    assert.equal(value.escalation?.onFailure, false);
    const numbers = [...document.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    await type(numbers[0]!, '600');
    assert.equal(value.browserBudgetSeconds, 600);
    await type(numbers[1]!, '80');
    assert.equal(value.escalation?.confidenceBelow, 0.8);
    assert.equal(value.escalation?.target, 'runtime:claude');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
