import { expect, test } from 'bun:test';
import { isTkSender } from './tk';

test('marks TK sender domains without trusting lookalikes or display names', () => {
  expect(isTkSender('service@tk.de')).toBe(true);
  expect(isTkSender('Postfach@service.tk.de')).toBe(true);
  expect(isTkSender('service@tk.de.evil.example')).toBe(false);
  expect(isTkSender('TK <service@evil.example>')).toBe(false);
  expect(isTkSender('service@fake-tk.de')).toBe(false);
});
