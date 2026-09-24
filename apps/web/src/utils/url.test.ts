import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isHttpUrl, normalizeUrl } from './url';

describe('normalizeUrl', () => {
  it('adds https to a bare domain', () => {
    assert.equal(normalizeUrl(' example.com/x '), 'https://example.com/x');
  });
  it('keeps a scheme that is already there', () => {
    assert.equal(normalizeUrl('http://example.com'), 'http://example.com');
    assert.equal(normalizeUrl('ftp://example.com'), 'ftp://example.com');
  });
  it('leaves an empty value empty', () => {
    assert.equal(normalizeUrl('   '), '');
  });
});

describe('isHttpUrl', () => {
  it('accepts absolute http(s) URLs', () => {
    assert.equal(isHttpUrl('https://example.com/hook'), true);
    assert.equal(isHttpUrl('http://example.com'), true);
    assert.equal(isHttpUrl('http://127.0.0.1:8080/x'), true);
    assert.equal(isHttpUrl('https://bücher.example/'), true);
  });
  it('refuses words, other schemes and spaces in the host', () => {
    assert.equal(isHttpUrl('abc'), false);
    assert.equal(isHttpUrl('https://kein url'), false);
    assert.equal(isHttpUrl('https://kein%20url'), false);
    assert.equal(isHttpUrl('ftp://example.com'), false);
    assert.equal(isHttpUrl('mailto:someone@example.com'), false);
  });
});
