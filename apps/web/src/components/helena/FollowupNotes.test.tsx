import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type { Followup } from '@/lib/api/endpoints/agentFollowups';
import chatWorkspace from '../../../messages/de/chatWorkspace.json';
import FollowupNotes from './FollowupNotes';
import FollowupModePicker from './FollowupModePicker';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={{ chatWorkspace }}>
      {node}
    </NextIntlClientProvider>,
  );
const item = (over: Partial<Followup>): Followup => ({
  id: 'a',
  mode: 'inject',
  state: 'pending',
  prompt: 'Nur src prüfen',
  nextId: null,
  ...over,
});

describe('instructions given while an answer runs', () => {
  it('shows the text, how it was sent and whether the agent took it over', () => {
    const html = wrap(
      <FollowupNotes
        items={[
          item({ id: '1', mode: 'inject', state: 'applied' }),
          item({ id: '2', mode: 'after', state: 'pending', prompt: 'Danach zusammenfassen' }),
        ]}
      />,
    );
    assert.match(html, /Nur src prüfen/);
    assert.match(html, /Einschieben/);
    assert.match(html, /übernommen/);
    assert.match(html, /Danach zusammenfassen/);
    assert.match(html, />Danach</);
    assert.match(html, />wartet</);
  });

  it('shows nothing without instructions', () => {
    assert.equal(wrap(<FollowupNotes items={[]} />), '');
  });
});

describe('the mode picker', () => {
  it('names the chosen mode and is not shown where the runtime has only one', () => {
    const noop = () => undefined;
    const many = wrap(
      <FollowupModePicker modes={['inject', 'after', 'replace']} mode="inject" onChange={noop} />,
    );
    assert.match(many, /Einschieben/);
    assert.match(many, /aria-label="Wie senden"/);
    assert.equal(wrap(<FollowupModePicker modes={['after']} mode="after" onChange={noop} />), '');
  });
});
