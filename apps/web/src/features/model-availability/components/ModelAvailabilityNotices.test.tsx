import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { act, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import type { SystemHealth } from '@/lib/api/endpoints/god';
import AgentModelIssue from './AgentModelIssue';
import ModelAvailabilityHealthLines from './ModelAvailabilityHealthLines';

// What the owner reads about refused models and dead logins (docs/helena-decisions/
// model-availability.md), rendered with the real messages: the German wording, and every
// language formats without an error (the messages use ICU select and plural).

const MESSAGES_DIR = join(process.cwd(), 'messages');
const read = (locale: string, namespace: string) =>
  JSON.parse(readFileSync(join(MESSAGES_DIR, locale, `${namespace}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
const messages = (locale: string) => ({
  modelAvailability: read(locale, 'modelAvailability'),
  teams: read(locale, 'teams'),
});

const replacedGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let dom: JSDOM;
let root: Root;
let saved: Map<string, PropertyDescriptor | undefined>;

beforeEach(async () => {
  saved = new Map(
    replacedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  dom = new JSDOM('<!doctype html><div id="root"></div>');
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.querySelector('#root')!);
});

afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function render(node: ReactNode, locale = 'de') {
  const errors: string[] = [];
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider
          locale={locale}
          messages={messages(locale)}
          timeZone="UTC"
          onError={(error) => errors.push(error.message)}
        >
          {node}
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  );
  return { view: document.querySelector('#root')!, errors };
}

const MODELS: SystemHealth['models'] = {
  unavailable: [
    {
      runtime: 'hermes',
      provider: 'openai-codex',
      model: 'gpt-6-terra',
      detail: 'not supported',
      since: '2026-09-24T17:07:00Z',
      agents: [
        { id: 15, teamId: 1, username: 'qa', template: true },
        { id: 31, teamId: 1, username: 'qa-e2e', template: false },
      ],
    },
    // Refused, but nobody runs it: no problem for the overview.
    {
      runtime: 'hermes',
      provider: 'openai-codex',
      model: 'gpt-5.3-codex-spark',
      detail: null,
      since: '2026-09-24T17:07:00Z',
      agents: [],
    },
  ],
  deadLogins: [
    {
      provider: 'anthropic',
      state: 'invalid',
      command: 'hermes auth add anthropic --type oauth',
      agents: [
        { id: 13, teamId: 1, username: 'code-reviewer', template: true, model: 'claude-opus-5' },
      ],
    },
  ],
};

const REFUSAL = {
  id: 'gpt-6-terra',
  provider: 'openai-codex',
  detail: "The 'gpt-6-terra' model is not supported when using Codex with a ChatGPT account.",
  since: '2026-09-24T17:07:00Z',
  findingId: 1,
};

const issue = (fields: Partial<Parameters<typeof AgentModelIssue>[0]>) => (
  <AgentModelIssue
    teamId={1}
    refusal={undefined}
    runtime="hermes"
    templateModel={null}
    model={null}
    canEdit
    onUseDefault={() => {}}
    {...fields}
  />
);

describe('the health overview', () => {
  it('names refused models agents still run and the agents on a dead login', () => {
    const { view, errors } = render(<ModelAvailabilityHealthLines models={MODELS} />);
    const text = view.textContent ?? '';
    assert.deepEqual(errors, []);
    assert.match(
      text,
      /gpt-6-terra ist für das Konto nicht verfügbar – 2 Agenten nutzen es: @qa, @qa-e2e/,
    );
    assert.doesNotMatch(text, /gpt-5\.3-codex-spark/);
    assert.match(
      text,
      /Claude-Anmeldung von Hermes ungültig – 1 Agent läuft darauf: @code-reviewer/,
    );
  });

  it('says nothing when all is well', () => {
    const { view } = render(<ModelAvailabilityHealthLines models={{ unavailable: [] }} />);
    assert.equal(view.textContent, '');
  });
});

describe('the agent editor notice', () => {
  it('names a refused model with the provider words and the way out', () => {
    const { view, errors } = render(issue({ refusal: REFUSAL, model: 'gpt-6-terra' }));
    assert.deepEqual(errors, []);
    const text = view.textContent ?? '';
    assert.match(
      text,
      /gpt-6-terra ist für dein ChatGPT-Konto nicht verfügbar – wähle ein anderes Modell\./,
    );
    assert.match(text, /Der Anbieter sagt: The 'gpt-6-terra' model is not supported/);
    assert.match(text, /Agenten-Standard verwenden/);
    assert.match(text, /Erneut prüfen/);
  });

  it('names a dead login with the command, and a copy that fell back', () => {
    const dead = render(
      issue({
        model: 'claude-opus-5',
        deadLogin: {
          provider: 'anthropic',
          state: 'invalid',
          command: 'hermes auth add anthropic --type oauth',
        },
      }),
    );
    assert.match(
      dead.view.textContent ?? '',
      /claude-opus-5 läuft über die Claude-Anmeldung von Hermes, die ungültig ist/,
    );
    assert.equal(
      dead.view.querySelector('code')?.textContent,
      'hermes auth add anthropic --type oauth',
    );
    const copy = render(issue({ templateModel: 'gpt-6-terra' }));
    assert.match(
      copy.view.textContent ?? '',
      /Die Vorlage nutzt gpt-6-terra, das für dein Konto nicht verfügbar ist\./,
    );
    assert.equal(render(issue({})).view.textContent, '');
  });

  it('formats in every language', () => {
    for (const locale of readdirSync(MESSAGES_DIR)) {
      for (const node of [
        <ModelAvailabilityHealthLines key="health" models={MODELS} />,
        issue({ refusal: REFUSAL, model: 'gpt-6-terra' }),
        issue({
          deadLogin: { provider: 'anthropic', state: 'expired', command: null },
        }),
        issue({ templateModel: 'gpt-6-terra' }),
      ]) {
        const { view, errors } = render(node, locale);
        assert.deepEqual(errors, [], locale);
        assert.ok((view.textContent ?? '').length > 0, locale);
      }
    }
  });
});
