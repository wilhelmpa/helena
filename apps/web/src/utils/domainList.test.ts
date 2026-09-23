import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDomainList } from './domainList';

describe('parseDomainList', () => {
  it('splits lines and trims each one', () => {
    assert.deepEqual(parseDomainList('example.com\n  api.example.com  '), [
      'example.com',
      'api.example.com',
    ]);
  });

  it('ignores blank lines, including windows line endings', () => {
    assert.deepEqual(parseDomainList('a.com\r\n\r\n\r\n  \nb.com\r\n'), ['a.com', 'b.com']);
  });

  it('drops case-insensitive duplicates, keeping the first spelling', () => {
    assert.deepEqual(parseDomainList('Example.com\nexample.com\nEXAMPLE.COM\nother.com'), [
      'Example.com',
      'other.com',
    ]);
  });

  it('returns an empty list for blank input', () => {
    assert.deepEqual(parseDomainList(''), []);
    assert.deepEqual(parseDomainList('   \n\n  \n'), []);
  });
});
