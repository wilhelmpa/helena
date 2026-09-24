import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeDomain } from './domainList';

describe('domain list normalization', () => {
  it('trims and lowercases a plain domain', () => {
    assert.equal(normalizeDomain('  Example.COM  '), 'example.com');
  });

  it('drops a scheme and a path', () => {
    assert.equal(normalizeDomain('https://Example.com/some/path'), 'example.com');
    assert.equal(normalizeDomain('http://example.com/'), 'example.com');
  });

  it('drops a leading wildcard, since a domain already covers its subdomains', () => {
    assert.equal(normalizeDomain('*.example.com'), 'example.com');
  });

  it('drops a trailing dot', () => {
    assert.equal(normalizeDomain('example.com.'), 'example.com');
  });

  it('rejects an empty or too-long value', () => {
    assert.equal(normalizeDomain('   '), null);
    assert.equal(normalizeDomain('*.'), null);
    assert.equal(normalizeDomain('a'.repeat(254)), null);
  });
});
