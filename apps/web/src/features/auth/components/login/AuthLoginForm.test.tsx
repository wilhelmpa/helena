import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, type ComponentType } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

// The password sign-in of an account with an authenticator app (Konto → Sicherheit):
// better-auth answers the password with `twoFactorRedirect` and no session, so the form must
// ask for the code instead of leaving for the app, and only the code's answer signs in
// (2026-09-25: the owner was locked out when the form went to "/" without a session).
// Rendered with the real form, the real better-auth client and the real German messages;
// only the network (fetch) and Next's router are stand-ins.

const API = 'http://api.test';
const replacedGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'IS_REACT_ACT_ENVIRONMENT',
  'fetch',
] as const;

type Call = { method: string; path: string; body: unknown };
let dom: JSDOM;
let root: Root;
let saved: Map<string, PropertyDescriptor | undefined>;
let calls: Call[];
let pushed: string[];
let signInAnswer: () => Response;

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// The API as the form sees it.
async function api(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  const text = request.method === 'GET' ? '' : await request.text();
  calls.push({ method: request.method, path: url.pathname, body: text ? JSON.parse(text) : null });
  switch (url.pathname) {
    case '/auth-config':
      return json({
        registration: 'closed',
        magicLink: false,
        requireEmailVerification: false,
        emailEnabled: false,
        emailPassword: true,
        google: false,
        oidc: false,
        oidcLabel: '',
      });
    case '/api/auth/sign-in/email':
    case '/api/auth/sign-in/username':
      return signInAnswer();
    case '/api/auth/two-factor/verify-totp': {
      const code = (calls.at(-1)!.body as { code?: string }).code;
      return code === '123456'
        ? json({ token: 'session-token', user: { id: 'owner', email: 'owner@example.com' } })
        : json({ code: 'INVALID_CODE', message: 'Invalid code' }, 401);
    }
    case '/api/auth/reset-password':
      return json({ status: true });
    case '/api/auth/get-session':
      return json(null);
    default:
      return json({ error: 'not found' }, 404);
  }
}

beforeEach(async () => {
  saved = new Map(
    replacedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://app.test/login' });
  (dom.window as unknown as { __ITSAPLAN_ENV__: unknown }).__ITSAPLAN_ENV__ = {
    apiUrl: API,
    privacyUrl: '',
    termsUrl: '',
    workspace: {},
  };
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    fetch: { configurable: true, writable: true, value: api },
  });
  calls = [];
  pushed = [];
  signInAnswer = () => json({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
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

async function render() {
  // Imported once the page's globals exist: the API client reads its origin at import.
  const [
    { default: AuthLoginForm },
    { NextIntlClientProvider },
    { QueryClient, QueryClientProvider },
    { AppRouterContext },
    { SearchParamsContext },
  ] = await Promise.all([
    import('./AuthLoginForm') as Promise<{ default: ComponentType }>,
    import('next-intl'),
    import('@tanstack/react-query'),
    import('next/dist/shared/lib/app-router-context.shared-runtime'),
    import('next/dist/shared/lib/hooks-client-context.shared-runtime'),
  ]);
  const router = {
    push: (href: string) => pushed.push(href),
    replace: (href: string) => pushed.push(href),
    refresh: () => {},
    prefetch: async () => {},
    back: () => {},
    forward: () => {},
  };
  const auth = JSON.parse(
    readFileSync(join(process.cwd(), 'messages', 'de', 'auth.json'), 'utf8'),
  ) as Record<string, unknown>;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="de" messages={{ auth }} timeZone="UTC">
        <QueryClientProvider client={queryClient}>
          <AppRouterContext.Provider value={router as never}>
            <SearchParamsContext.Provider value={new URLSearchParams() as never}>
              <AuthLoginForm />
            </SearchParamsContext.Provider>
          </AppRouterContext.Provider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  return document.querySelector('#root')!;
}

// Types like a person: React listens to the input event with the native value setter.
async function type(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector);
  assert.ok(input, `no field ${selector}`);
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!;
  await act(async () => {
    setter.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    document
      .querySelector('form')!
      .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 100 && !check(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  assert.ok(check(), what);
}

describe('password sign-in with an authenticator app', () => {
  it('asks for the code, stays on the page, and signs in with the code', async () => {
    const view = await render();
    await type('#identifier', 'owner@example.com');
    await type('#password', 'correct horse');
    await submit();

    await until(() => Boolean(view.querySelector('#code')), 'the code field appears');
    assert.deepEqual(pushed, [], 'no navigation without a session');
    assert.equal(view.querySelector('#password'), null, 'the password step is gone');
    assert.match(view.textContent ?? '', /Code/);
    assert.ok(
      calls.some((call) => call.path === '/api/auth/sign-in/email'),
      'the password went to the sign-in endpoint',
    );

    await type('#code', '123 456');
    await submit();
    await until(() => pushed.length > 0, 'the app opens after the code');
    assert.deepEqual(pushed, ['/']);
    const verify = calls.find((call) => call.path === '/api/auth/two-factor/verify-totp');
    assert.deepEqual(verify?.body, { code: '123456', trustDevice: true });
  });

  it('keeps the code step and says so when the code is wrong', async () => {
    const view = await render();
    await type('#identifier', 'wilhelmpa');
    await type('#password', 'correct horse');
    await submit();
    await until(() => Boolean(view.querySelector('#code')), 'the code field appears');
    // A username goes to the username endpoint and gets the same second step.
    assert.ok(calls.some((call) => call.path === '/api/auth/sign-in/username'));

    await type('#code', '000000');
    await submit();
    await until(
      () => calls.some((call) => call.path === '/api/auth/two-factor/verify-totp'),
      'the code was checked',
    );
    await until(() => (view.textContent ?? '').includes('Invalid code'), 'the error is shown');
    assert.deepEqual(pushed, []);
    assert.ok(view.querySelector('#code'), 'still on the code step');
  });

  it('does not claim a session after password reset while TOTP is pending', async () => {
    const { setNewPassword } = await import('../../services/auth.service');
    const outcome = await setNewPassword({
      token: 'fixture-reset-token',
      email: 'owner@example.com',
      newPassword: 'replacement-password',
    });
    assert.deepEqual(outcome, { signedIn: false });
    assert.deepEqual(pushed, []);
    assert.ok(calls.some((call) => call.path === '/api/auth/sign-in/email'));
  });

  it('goes straight in when the account has no authenticator app', async () => {
    signInAnswer = () => json({ redirect: false, token: 'session-token', user: { id: 'owner' } });
    const view = await render();
    await type('#identifier', 'owner@example.com');
    await type('#password', 'correct horse');
    await submit();
    await until(() => pushed.length > 0, 'the app opens');
    assert.deepEqual(pushed, ['/']);
    assert.equal(view.querySelector('#code'), null);
  });
});

it('selecting a remembered name fills the identifier but cannot authenticate or retain another password', async () => {
  dom.window.localStorage.setItem(
    'helena.remembered-people',
    JSON.stringify([
      { name: 'Elli fixture', email: 'elli@example.test', role: 'god', token: 'forged' },
    ]),
  );
  await render();
  await type('#password', 'previous-person-password');
  const choice = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === 'Elli fixture',
  );
  assert.ok(choice);
  await act(async () => choice.click());
  assert.equal(document.querySelector<HTMLInputElement>('#identifier')!.value, 'elli@example.test');
  assert.equal(document.querySelector<HTMLInputElement>('#password')!.value, '');
  assert.deepEqual(pushed, []);
  assert.equal(
    calls.some((call) => call.path.includes('/sign-in/')),
    false,
  );
});
