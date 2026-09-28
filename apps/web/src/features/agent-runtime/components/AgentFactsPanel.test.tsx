import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { act } from 'react';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import agentRuntime from '../../../../messages/en/agentRuntime.json';

// The facts an agent keeps, in its memory editor: the owner corrects a fact's text, confirms
// it (more trust) or removes it; the daily notes open by day.

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};
const calls: Record<string, unknown>[] = [];
mock.module('../services/agentRuntime.service', () => ({
  useAgentFacts: () => ({
    isPending: false,
    data: [
      {
        id: 7,
        content: 'Halogen läuft auf Kingston',
        category: 'general',
        tags: [],
        entities: ['Halogen', 'Kingston'],
        trust: 0.55,
        project: 'VOL',
        confirmations: 1,
        helpful: 0,
        unhelpful: 0,
        contradictedBy: 9,
        updatedAt: '2026-09-28T10:00:00.000Z',
      },
    ],
  }),
  useAgentNotes: () => ({
    data: [
      { day: '2026-09-28', content: '- 10:00 Deploy geprüft\n', updatedAt: '2026-09-28T10:00:00Z' },
    ],
  }),
  useCorrectFact: () => ({
    isPending: false,
    mutate: (input: Record<string, unknown>, options?: { onSuccess?: () => void }) => {
      calls.push(input);
      options?.onSuccess?.();
    },
  }),
}));
const { AgentFactsSection, AgentNotesSection } = await import('./AgentFactsPanel');

async function withDom(run: (root: import('react-dom/client').Root) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const saved = new Map(
    ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
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
  try {
    await run(root);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (entry) => entry.textContent?.trim() === label,
  )!;

test('the owner confirms, corrects and removes a fact', async () => {
  calls.length = 0;
  await withDom(async (root) => {
    await act(async () =>
      root.render(
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ agentRuntime }}>
          <AgentFactsSection teamId={1} agentId={2} canEdit />
        </NextIntlClientProvider>,
      ),
    );
    const text = document.body.textContent ?? '';
    assert.match(text, /Halogen läuft auf Kingston/);
    assert.match(text, /55 %/);
    assert.match(text, /possible contradiction/);
    await act(async () => button('Correct').click());
    assert.deepEqual(calls.at(-1), { id: 7, trust: 0.75 });
    await act(async () => button('Edit').click());
    const input = document.querySelector<HTMLInputElement>('input')!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      setter.call(input, 'Halogen läuft auf Kingston an Port 8731');
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await act(async () => button('Save').click());
    assert.deepEqual(calls.at(-1), { id: 7, content: 'Halogen läuft auf Kingston an Port 8731' });
    await act(async () => button('Remove').click());
    assert.deepEqual(calls.at(-1), { id: 7, remove: true });
  });
});

test('a daily note opens with its lines', async () => {
  await withDom(async (root) => {
    await act(async () =>
      root.render(
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ agentRuntime }}>
          <AgentNotesSection teamId={1} agentId={2} />
        </NextIntlClientProvider>,
      ),
    );
    assert.doesNotMatch(document.body.textContent ?? '', /Deploy geprüft/);
    await act(async () => document.querySelector<HTMLButtonElement>('button')!.click());
    assert.match(document.body.textContent ?? '', /Deploy geprüft/);
  });
});
