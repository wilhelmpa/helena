import { describe, expect, test } from 'bun:test';
import { SECRET_MASK, SecretMask } from '../index';

const TOKEN = 'cf-token-0123456789abcdefghijklmnopqrstuv';

describe('SecretMask', () => {
  test('masks every exact occurrence, the longer value whole, and leaves short values alone', () => {
    const mask = new SecretMask([TOKEN, TOKEN.slice(0, 20), 'short', null, undefined]);
    expect(mask.secrets).toEqual([TOKEN, TOKEN.slice(0, 20)]);
    expect(mask.text(`a ${TOKEN} b ${TOKEN}`)).toBe(`a ${SECRET_MASK} b ${SECRET_MASK}`);
    expect(mask.text(`only ${TOKEN.slice(0, 20)}!`)).toBe(`only ${SECRET_MASK}!`);
    expect(mask.text('a short word')).toBe('a short word');
  });

  test('masks the strings of a JSON value and keeps its keys and other values', () => {
    const mask = new SecretMask([TOKEN]);
    expect(
      mask.value({ [TOKEN]: 1, list: [TOKEN, 2, { deep: `x${TOKEN}` }], ok: true, n: null }),
    ).toEqual({ [TOKEN]: 1, list: [SECRET_MASK, 2, { deep: `x${SECRET_MASK}` }], ok: true, n: null });
    const empty = new SecretMask();
    const value = { a: TOKEN };
    expect(empty.value(value)).toBe(value);
  });

  test('a stream holds back what could still become a secret', () => {
    const stream = new SecretMask([TOKEN]).stream();
    let out = '';
    for (const piece of ['The value ', 'is cf-to', 'ken-0123456789', 'abcdefghijklmnopqrstuv', ', done.']) {
      out += stream.push(piece);
      expect(out).not.toContain('cf-to');
    }
    out += stream.end();
    expect(out).toBe(`The value is ${SECRET_MASK}, done.`);
  });

  test('a stream passes text through at once when nothing could be a secret', () => {
    const stream = new SecretMask([TOKEN]).stream();
    expect(stream.push('plain words ')).toBe('plain words ');
    expect(stream.push('then c')).toBe('then ');
    expect(stream.push('at')).toBe('cat');
    expect(stream.end()).toBe('');
    const none = new SecretMask().stream();
    expect(none.push('cf-to')).toBe('cf-to');
  });

  test('with() joins two masks', () => {
    const mask = new SecretMask(['first-secret']).with(['second-secret']);
    expect(mask.text('first-secret second-secret')).toBe(`${SECRET_MASK} ${SECRET_MASK}`);
  });
});
