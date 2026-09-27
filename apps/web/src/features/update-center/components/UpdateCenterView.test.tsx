import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import type { UpdateCenter } from '@/lib/api/endpoints/updateCenter';
import UpdateCenterView from './UpdateCenterView';
import UpdatesTile from './UpdatesTile';
import { updateCenterKey } from '../services/updateCenter.service';
import common from '../../../../messages/en/common.json';
import updates from '../../../../messages/en/updates.json';
import routines from '../../../../messages/en/routines.json';
import home from '../../../../messages/en/home.json';

const center: UpdateCenter = {
  checkedAt: '2026-09-26T06:00:00Z',
  helper: { installed: true, error: null },
  counts: { updates: 0, security: 0, applicable: 0 },
  sources: [],
  items: [],
  actions: [],
  settings: {
    enabled: false,
    cron: '0 6 * * *',
    timezone: 'UTC',
    summarize: false,
    agentId: null,
    model: null,
    reasoning: 'low',
    claudeChannel: 'stable',
    modes: {},
  },
  digest: {
    agentId: null,
    agentName: null,
    model: null,
    reasoning: null,
    agents: [],
    models: [],
  },
  job: {
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    lastTrigger: null,
    nextRunAt: null,
  },
};

test('dashboard shows automatic rollback with its reason', () => {
  const client = new QueryClient();
  client.setQueryData(updateCenterKey, {
    ...center,
    actions: [
      {
        id: 1,
        source: 'cli-runtimes',
        component: 'codex',
        name: 'Codex CLI',
        components: ['codex'],
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        state: 'failed',
        automatic: true,
        backupPath: null,
        log: null,
        error: 'update failed; previous version restored: smoke failed',
        result: null,
        health: null,
        requestedAt: '2026-09-27T06:00:00Z',
        finishedAt: '2026-09-27T06:01:00Z',
      },
    ],
  } satisfies UpdateCenter);
  const markup = renderToStaticMarkup(
    <NextIntlClientProvider
      locale="en"
      timeZone="UTC"
      messages={{ common, updates, routines, home }}
    >
      <QueryClientProvider client={client}>
        <UpdatesTile />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  assert.ok(markup.includes('Rolled back'));
  assert.ok(markup.includes('smoke failed'));
});

for (const failure of ['http', 'network'] as const) {
  test(`initial ${failure} failure shows safe status recovery and reload sends only GET`, async () => {
    const dom = new JSDOM('<div id="root"></div>', {
      url: 'https://helena.test/god/server/updates',
    });
    const globals = [
      'window',
      'document',
      'navigator',
      'HTMLElement',
      'HTMLFormElement',
      'HTMLInputElement',
      'Element',
      'Node',
      'IS_REACT_ACT_ENVIRONMENT',
    ];
    const descriptors = new Map(
      globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
    );
    for (const key of globals)
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value:
          key === 'IS_REACT_ACT_ENVIRONMENT'
            ? true
            : (dom.window as unknown as Record<string, unknown>)[key],
      });
    const requests: { url: string; method: string }[] = [];
    const replies: { resolve: (response: Response) => void; reject: (reason: Error) => void }[] =
      [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? 'GET' });
      return new Promise<Response>((resolve, reject) => replies.push({ resolve, reject }));
    }) as typeof fetch;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(document.getElementById('root')!);
    const text = () => document.body.textContent ?? '';
    async function settle(condition: () => boolean) {
      const deadline = Date.now() + 1_000;
      while (!condition() && Date.now() < deadline)
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      assert.ok(condition(), 'expected update status UI did not settle');
    }
    try {
      await act(async () =>
        root.render(
          <NextIntlClientProvider
            locale="en"
            timeZone="UTC"
            messages={{ common, updates, routines }}
          >
            <QueryClientProvider client={client}>
              <UpdateCenterView />
            </QueryClientProvider>
          </NextIntlClientProvider>,
        ),
      );
      await settle(() => replies.length === 1);
      assert.ok(document.querySelector('[data-slot="skeleton"]'));
      assert.ok(!text().includes(updates.loadFailed));
      assert.ok(!text().includes(updates.allCurrent));

      const detail = 'synthetic-provider-detail-must-not-appear';
      await act(async () => {
        if (failure === 'http')
          replies[0]!.resolve(Response.json({ error: detail }, { status: 503 }));
        else replies[0]!.reject(new TypeError(detail));
      });
      await settle(() => text().includes(updates.loadFailed));
      assert.ok(text().includes(updates.loadFailedHint));
      assert.ok(!text().includes(detail));
      assert.ok(!text().includes(updates.allCurrent));
      assert.equal(document.querySelector('[data-slot="skeleton"]'), null);
      const reload = document.querySelector('button')!;
      assert.equal(reload.textContent, common.reload);
      await act(async () => reload.click());
      await settle(() => replies.length === 2);
      assert.ok(!text().includes(updates.allCurrent));

      await act(async () => replies[1]!.resolve(Response.json(center)));
      await settle(() => text().includes(updates.allCurrent));
      assert.ok(!text().includes(updates.loadFailed));
      assert.ok(!text().includes(updates.checkIncomplete));
      assert.equal(requests.length, 2);
      assert.ok(requests.every(({ method }) => method === 'GET'));
      assert.ok(requests.every(({ url }) => new URL(url).pathname === '/god/update-center'));
    } finally {
      await act(async () => root.unmount());
      client.clear();
      globalThis.fetch = originalFetch;
      dom.window.close();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
}
