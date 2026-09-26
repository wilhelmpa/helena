import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import { WebLinksContext } from '@/context/webLinks';
import { installWebLinkNavigation } from '@/utils/webLinkNavigation';
import type { WebLinkScope as Scope } from '@/utils/webLinkScope';
import { Button } from '@/components/ui/button';
import Markdown from './Markdown';
import { AgentMarkdown } from '@/components/agent-message/AgentMarkdown';
import EditorLinkPreviewCard from './editor/EditorLinkPreviewCard';
import WebLinkScope from './WebLinkScope';
import common from '../../../messages/en/common.json';

// Render the real markdown/button/portal components, not hand-built equivalents.
test('markdown, agent markdown, link buttons and editor portals retain their source scope across Home', async () => {
  const dom = new JSDOM('<div id="root"></div><div id="portal"></div>', {
    url: 'https://helena.test/',
  });
  const globals = [
    'window',
    'document',
    'navigator',
    'Element',
    'HTMLElement',
    'Node',
    'MutationObserver',
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
  const opened: [string, Scope][] = [];
  const open = (url: string, scope: Scope) => {
    opened.push([url, scope]);
  };
  const unlink = installWebLinkNavigation(
    dom.window.document,
    open,
    () => null,
    dom.window.location.href,
  );
  const root = createRoot(document.getElementById('root')!);
  let external = 0;
  dom.window.open = () => {
    external++;
    return null;
  };
  try {
    await act(async () =>
      root.render(
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ common }}>
          <WebLinksContext.Provider value={{ open, scope: null }}>
            <WebLinkScope projectKey="OTHER">
              <Markdown>{'[Markdown](https://example.test/markdown)'}</Markdown>
              <AgentMarkdown>{'[Agent](https://example.test/agent)'}</AgentMarkdown>
              <Button asChild>
                <a href="https://example.test/button" target="_blank" rel="noreferrer">
                  Button link
                </a>
              </Button>
              {createPortal(
                <>
                  <Markdown>{'[Portal markdown](https://example.test/portal-markdown)'}</Markdown>
                  <AgentMarkdown>
                    {'[Portal agent](https://example.test/portal-agent)'}
                  </AgentMarkdown>
                </>,
                document.getElementById('portal')!,
              )}
              {createPortal(
                <EditorLinkPreviewCard
                  url="https://example.test/preview"
                  preview={undefined}
                  loading={false}
                />,
                document.getElementById('portal')!,
              )}
            </WebLinkScope>
          </WebLinksContext.Provider>
        </NextIntlClientProvider>,
      ),
    );
    const anchors = [
      ...document.querySelectorAll<HTMLAnchorElement>('a[href^="https://example.test"]'),
    ];
    assert.equal(anchors.length, 6);
    for (const anchor of anchors)
      anchor.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.deepEqual(
      opened.map((entry) => entry[1]),
      ['OTHER', 'OTHER', 'OTHER', 'OTHER', 'OTHER', 'OTHER'],
    );
    assert.equal(external, 0);
    await act(async () =>
      root.render(
        <WebLinksContext.Provider value={{ open, scope: null }}>
          <WebLinkScope projectKey={null}>
            <Markdown>{'[Home](https://example.test/home)'}</Markdown>
          </WebLinkScope>
        </WebLinksContext.Provider>,
      ),
    );
    document
      .querySelector('a')!
      .dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    assert.deepEqual(opened.at(-1), ['https://example.test/home', null]);
  } finally {
    await act(async () => root.unmount());
    unlink();
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
