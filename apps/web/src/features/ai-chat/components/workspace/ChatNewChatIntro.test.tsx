import assert from 'node:assert/strict';
import { it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { DisplayNameProvider } from '@/context/displayName';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import chatWorkspace from '../../../../../messages/en/chatWorkspace.json';
import ChatNewChatIntro from './ChatNewChatIntro';

it('introduces the Home agent by the configured brand name and preserves other agent names', () => {
  for (const [agentRole, name, expected] of [
    ['home', 'Home', 'Alma'],
    ['agent', 'Koordinator MKT', 'Koordinator MKT'],
  ] as const) {
    const html = renderToStaticMarkup(
      <DisplayNameProvider name="Alma">
        <NextIntlClientProvider locale="en" messages={{ chatWorkspace }} timeZone="UTC">
          <ChatNewChatIntro agent={{ name, agentRole } as AiAgent} />
        </NextIntlClientProvider>
      </DisplayNameProvider>,
    );
    assert.ok(html.includes(expected));
    assert.ok(!html.includes('Home'));
  }
});
