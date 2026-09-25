import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { base64UrlToBytes, bytesToBase64Url } from './base64';

describe('base64url', () => {
  it('round-trips a VAPID public key', () => {
    const key =
      'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
    const bytes = base64UrlToBytes(key);
    assert.equal(bytes.length, 65);
    assert.equal(bytes[0], 0x04);
    assert.equal(bytesToBase64Url(bytes), key);
    assert.equal(bytesToBase64Url(bytes.buffer), key);
  });
});
