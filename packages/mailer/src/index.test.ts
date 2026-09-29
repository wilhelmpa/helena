import { expect, test } from 'bun:test';
import { emailBody } from './index';

test('mail header follows the display name', () => {
  const mail = emailBody('Welcome to Atlas', null, 'Atlas');
  expect(mail.text).toContain('Atlas');
  expect(mail.html).toContain('>Atlas</td>');
  expect(mail.html).not.toContain('Helena');
});
