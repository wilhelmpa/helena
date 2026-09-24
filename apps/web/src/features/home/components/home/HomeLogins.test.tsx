import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import type { RuntimeLogin, RuntimeLoginsHealth } from '@/lib/api/endpoints/god';
import HomeLogins from './HomeLogins';

// The health overview's "Anmeldungen" (docs/helena-decisions/token-keeper.md), rendered with
// the real German messages: by what the owner has to do. A rejected login names the owner's
// command, a renewed one reads "aktiv" with the access token's time only in its tooltip, and
// nothing shows without a token keeper.

const MESSAGES_DIR = join(process.cwd(), 'messages');
const messages = (locale: string) => ({
  god: JSON.parse(readFileSync(join(MESSAGES_DIR, locale, 'god.json'), 'utf8')) as Record<
    string,
    unknown
  >,
  providerLimits: JSON.parse(
    readFileSync(join(MESSAGES_DIR, locale, 'providerLimits.json'), 'utf8'),
  ) as Record<string, unknown>,
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

function render(health: RuntimeLoginsHealth | undefined, locale = 'de') {
  act(() =>
    root.render(
      <NextIntlClientProvider locale={locale} messages={messages(locale)} timeZone="UTC">
        <HomeLogins health={health} />
      </NextIntlClientProvider>,
    ),
  );
  return document.querySelector('#root')!;
}

const COMMAND =
  'sudo -u volition-hermes env HOME=/var/lib/volition/hermes HERMES_HOME=/var/lib/volition/hermes ' +
  '/var/lib/volition/hermes/venv/bin/hermes auth add anthropic --type oauth && sudo systemctl start helena-token-keeper.service';

function login(fields: Partial<RuntimeLogin>): RuntimeLogin {
  return {
    store: 'hermes',
    provider: 'openai-codex',
    id: 'def456',
    label: null,
    managed: true,
    state: 'ok',
    expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    refreshedAt: null,
    error: null,
    command: null,
    note: null,
    ...fields,
  };
}

function health(logins: RuntimeLogin[], stale = false): RuntimeLoginsHealth {
  return {
    reports: [
      {
        source: 'token-keeper',
        reporter: 'helena-token-keeper',
        checkedAt: new Date().toISOString(),
        intervalSeconds: 600,
        stale,
        logins,
        errors: [],
      },
    ],
    problems: 0,
  };
}

describe('HomeLogins', () => {
  it('names the owners command under a rejected login', () => {
    const view = render(
      health([
        login({}),
        login({
          provider: 'anthropic',
          id: 'abc123',
          state: 'invalid',
          error: 'HTTP 400 invalid_grant',
          command: COMMAND,
        }),
      ]),
    );
    const text = view.textContent ?? '';
    assert.match(text, /Anmeldungen/);
    assert.match(text, /1 braucht dich/);
    assert.match(text, /Claude in Hermes neu anmelden/);
    assert.match(text, /Neu anmelden/);
    assert.match(text, /ChatGPT/);
    assert.match(text, /aktiv · erneuert sich automatisch/);
    // No countdown of the access token in the row, only in its tooltip.
    assert.doesNotMatch(text, /noch \d/);
    assert.match(
      view.querySelector('[title*="Zugangsschlüssel bis"]')?.getAttribute('title') ?? '',
      /wird vorher erneuert/,
    );
    assert.equal(view.querySelector('code')?.textContent, COMMAND);
    assert.ok(view.querySelector('button[aria-label="Befehl kopieren"]'));
  });

  it('shows a renewal that fails for now in amber, without a command', () => {
    const text = render(health([login({ state: 'error' })])).textContent ?? '';
    assert.match(text, /Erneuerung klappt gerade nicht · nächster Versuch automatisch/);
    assert.match(text, /1 Erneuerung hakt/);
    assert.doesNotMatch(text, /braucht dich/);
  });

  it('shows nothing without a keeper, and says when the keeper stopped', () => {
    assert.equal(render(undefined).textContent, '');
    assert.equal(render({ reports: [], problems: 0 }).textContent, '');
    const stale = render(health([login({ state: 'expired' })], true)).textContent ?? '';
    assert.match(stale, /Token-Keeper hat sich seit/);
    assert.match(stale, /Token-Keeper meldet sich nicht/);
    assert.doesNotMatch(stale, /braucht dich/);
  });

  it('has its words in every language', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      value && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, item]) => keys(item, `${prefix}${key}.`))
        : [prefix];
    const german = keys((messages('de').god.systemHealth as Record<string, unknown>).logins);
    for (const locale of readdirSync(MESSAGES_DIR)) {
      const god = messages(locale).god;
      const logins = (god.systemHealth as Record<string, unknown>).logins;
      assert.deepEqual(keys(logins), german, locale);
      assert.ok((god.plugins as { names: Record<string, string> }).names.logins, locale);
    }
  });
});
