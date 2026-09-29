import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '@/lib/api/core/client';
import { problemOfMessage, problemOfRequest } from './tradingErrors';

// The API names a widget's reason in English (apps/api trading/widget-data.ts); the
// dashboard turns each into a kind it can word in the reader's language.
describe('trading widget problems', () => {
  it('knows every reason the API gives', () => {
    const cases: [string, string][] = [
      ['Select a paper connection for this dashboard.', 'selectConnection'],
      ['No paper connection is available for this project.', 'noConnection'],
      ['The paper connection is unavailable.', 'connectionUnavailable'],
      ['Paper connection unavailable.', 'connectionUnavailable'],
      ['Only a paper connection can be used.', 'notPaper'],
      ["Refused: api.alpaca.markets is not Alpaca's paper API.", 'notPaper'],
      ['The daily paper order list is incomplete.', 'ordersIncomplete'],
      ['Incomplete portfolio history.', 'historyIncomplete'],
      ['Trading data could not be loaded.', 'generic'],
      ['something nobody wrote a case for', 'generic'],
    ];
    for (const [message, kind] of cases)
      assert.equal(problemOfMessage(message).kind, kind, message);
  });

  it('keeps the provider status', () => {
    assert.deepEqual(problemOfMessage('Alpaca paper API returned HTTP 503.'), {
      kind: 'provider',
      status: 503,
    });
  });

  it('words a failed request by its status, never by the raw message', () => {
    assert.equal(problemOfRequest(new ApiError(403, 'forbidden')).kind, 'noAccess');
    assert.equal(problemOfRequest(new ApiError(401, 'x')).kind, 'noAccess');
    assert.deepEqual(problemOfRequest(new ApiError(502, 'bad gateway')), {
      kind: 'provider',
      status: null,
    });
    assert.equal(problemOfRequest(new Error('boom')).kind, 'generic');
  });
});
