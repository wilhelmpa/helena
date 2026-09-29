import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chatContextItem, chatPagePath } from './chatContext';

const params = (query: string) => new URLSearchParams(query);

describe('chat page context', () => {
  it('carries the task open in the side panel with the page', () => {
    assert.equal(
      chatPagePath('/project/TRADE', params('filter=x'), { identifier: 'TRADE-3' }),
      '/project/TRADE?task=TRADE-3',
    );
  });

  it('keeps the knowledge file and leaves a task page as it is', () => {
    assert.equal(
      chatPagePath('/project/TRADE/files', params('file=Berichte/Wochenbericht.md&x=1'), null),
      '/project/TRADE/files?file=Berichte%2FWochenbericht.md',
    );
    assert.equal(
      chatPagePath('/project/TRADE/issue/3', params(''), { identifier: 'TRADE-3' }),
      '/project/TRADE/issue/3',
    );
  });

  it('names the task first, else the open document', () => {
    assert.deepEqual(
      chatContextItem(params('file=Docs/Regelwerk.md'), { identifier: 'TRADE-3', title: 'SPY' }),
      { kind: 'task', identifier: 'TRADE-3', title: 'SPY' },
    );
    assert.deepEqual(chatContextItem(params('file=Docs/Regelwerk.md'), null), {
      kind: 'document',
      name: 'Regelwerk.md',
    });
    assert.equal(chatContextItem(params(''), null), null);
  });
});
