import { HttpError } from '#shared/lib';

// Classify closed better-auth codes; never expose its exception or factor data.
export function totpFailure(error: unknown): HttpError {
  const value =
    error && typeof error === 'object'
      ? (error as { body?: { code?: unknown }; statusCode?: unknown })
      : null;
  const code = value?.body?.code;
  if (code === 'INVALID_CODE')
    return new HttpError(400, 'The code was not accepted', 'TERMINAL_INVALID_CODE');
  if (code === 'TOTP_NOT_ENABLED' || code === 'TOTP_NOT_CONFIGURED')
    return new HttpError(
      409,
      'Complete authenticator setup in Account Security',
      'TERMINAL_TOTP_NOT_ENABLED',
    );
  if (value?.statusCode === 429 || code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE')
    return new HttpError(
      429,
      'Too many attempts. Wait before trying again.',
      'TERMINAL_RATE_LIMITED',
    );
  return new HttpError(
    503,
    'Terminal verification is temporarily unavailable',
    'TERMINAL_VERIFY_UNAVAILABLE',
  );
}
