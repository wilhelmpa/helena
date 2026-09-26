import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { JSDOM } from 'jsdom';
import { WebLinksContext } from '@/context/webLinks';
import { qk } from '@/services/queryKeys';
import type { MailThread } from '@/lib/api/endpoints/mail';
import type { WebLinkScope } from '@/utils/webLinkScope';
import MailReadingPane from './MailReadingPane';
import mail from '../../../../messages/en/mail.json';
import common from '../../../../messages/en/common.json';

const noAction = () => {};
const html = '<a href="https://synthetic.example/mail">Synthetic link</a>';
function thread(projectKey: string | null, id: number): MailThread {
  return {
    id,
    teamId: 1,
    subject: 'Synthetic fixture',
    projectId: projectKey ? 1 : null,
    projectKey,
    projectName: projectKey,
    suggestedProjectId: null,
    suggestedProjectKey: null,
    suggestedProjectName: null,
    accountId: 1,
    accountName: 'Fixture',
    accountAddress: 'fixture@example.test',
    issues: [],
    drafts: [],
    messages: [
      {
        id,
        messageId: `fixture-${id}`,
        subject: 'Synthetic fixture',
        fromName: 'Fixture',
        fromAddress: 'fixture@example.test',
        to: [],
        cc: [],
        bcc: [],
        replyTo: [],
        sentAt: '2026-09-26T10:00:00Z',
        text: 'Synthetic text',
        html,
        hasRemoteImages: false,
        allowRemoteImages: false,
        seen: true,
        flagged: false,
        folders: [],
        attachments: [],
      },
    ],
  };
}

test('Home mail reading preserves the loaded thread project for real sandbox-frame links, including Home mail', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://helena.test/inbox' });
  const globals = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'ResizeObserver',
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
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  dom.window.HTMLElement.prototype.scrollIntoView = noAction;
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    throw new Error('No network in this fixture');
  }) as typeof fetch;
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity } },
  });
  const opened: [string, WebLinkScope][] = [];
  const open = (url: string, scope: WebLinkScope) => {
    opened.push([url, scope]);
  };
  const root = createRoot(document.getElementById('root')!);
  try {
    for (const [index, projectKey] of ['PRIV', null].entries()) {
      const id = index + 1;
      client.setQueryData(qk.mailThread(id), thread(projectKey, id));
      await act(async () =>
        root.render(
          <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ mail, common }}>
            <QueryClientProvider client={client}>
              <AppRouterContext.Provider value={{ push: noAction } as never}>
                <WebLinksContext.Provider value={{ open, scope: null }}>
                  <MailReadingPane
                    key={id}
                    teamId={1}
                    threadId={id}
                    onBack={noAction}
                    onDraft={noAction}
                    onArchive={noAction}
                    onMove={noAction}
                    onRemoved={noAction}
                  />
                </WebLinksContext.Provider>
              </AppRouterContext.Provider>
            </QueryClientProvider>
          </NextIntlClientProvider>,
        ),
      );
      const frame = document.querySelector('iframe')!;
      assert.equal(frame.getAttribute('sandbox')!.split(' ').includes('allow-scripts'), false);
      // jsdom does not parse srcdoc; populate that already-rendered frame with the
      // same synthetic content and deliver load to the real parent's listener.
      frame.contentDocument!.body.innerHTML = html;
      await act(async () => frame.dispatchEvent(new dom.window.Event('load')));
      const anchor = frame.contentDocument!.querySelector('a')!;
      anchor.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert.deepEqual(opened.at(-1), ['https://synthetic.example/mail', projectKey]);
    }
    assert.equal(requests, 0);
    assert.equal(opened.length, 2);
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
