import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipients } from './recipients';

describe('parseRecipients', () => {
  it('reads plain and named addresses separated by commas or semicolons', () => {
    assert.deepEqual(parseRecipients('Anna@Verve.example; "Bob B" <bob@x.de>, carl@y.org'), {
      addresses: [
        { name: '', address: 'anna@verve.example' },
        { name: 'Bob B', address: 'bob@x.de' },
        { name: '', address: 'carl@y.org' },
      ],
      rest: '',
    });
  });

  it('keeps what is not an address for the reader to correct', () => {
    assert.deepEqual(parseRecipients('anna@, dora@verve.example'), {
      addresses: [{ name: '', address: 'dora@verve.example' }],
      rest: 'anna@',
    });
  });
});
