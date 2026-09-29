import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import inbox from '../../../messages/en/inbox.json';
import { withDom } from '../../../test/dom';

// Home's inbox has the tabs of a project's (owner 29.09., O82): the mail first, then what
// needs the owner, with how many are waiting.
const { default: OwnerInboxTabs } = await import('./OwnerInboxTabs');

test('the tabs read Messages then Updates, the count on the updates', async () => {
  await withDom('https://ava.example/inbox', async () => {
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    const chosen: string[] = [];
    try {
      await act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ inbox }}>
            <OwnerInboxTabs tab="messages" waiting={3} onChange={(tab) => chosen.push(tab)} />
          </NextIntlClientProvider>,
        );
      });
      const tabs = [...document.querySelectorAll('[role="tab"], [role="radio"], button')];
      assert.deepEqual(
        tabs.map((tab) => tab.textContent?.replace(/\s+/g, ' ').trim()),
        [inbox.hub.messages, `${inbox.hub.updates}3`],
      );
      await act(async () => (tabs[1] as HTMLElement).click());
      assert.deepEqual(chosen, ['updates']);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
