import { expect, test } from 'bun:test';
import { totpFailure } from '../../totp-errors';

test('only an actual invalid-code response is reported as a wrong code', () => {
  expect(totpFailure({ body: { code: 'INVALID_CODE' } })).toMatchObject({
    status: 400,
    code: 'TERMINAL_INVALID_CODE',
  });
  expect(totpFailure({ body: { code: 'TOTP_NOT_ENABLED' } })).toMatchObject({
    status: 409,
    code: 'TERMINAL_TOTP_NOT_ENABLED',
  });
  expect(totpFailure({ statusCode: 429 })).toMatchObject({ status: 429 });
  for (const error of [
    new Error('private factor data'),
    { body: { code: 'INVALID_TWO_FACTOR_COOKIE', message: 'private' } },
    null,
  ]) {
    const failure = totpFailure(error);
    expect(failure).toMatchObject({ status: 503, code: 'TERMINAL_VERIFY_UNAVAILABLE' });
    expect(failure.message).not.toContain('private');
  }
});
