import { ApiError } from '@/lib/api/core/client';

export function stepUpFailure(
  error: unknown,
): 'rateLimited' | 'wrongCode' | 'setupRequired' | 'unavailable' {
  if (!(error instanceof ApiError)) return 'unavailable';
  if (error.status === 429) return 'rateLimited';
  if (error.code === 'TERMINAL_TOTP_NOT_ENABLED') return 'setupRequired';
  if (error.code === 'TERMINAL_INVALID_CODE' || (error.status === 400 && !error.code))
    return 'wrongCode';
  return 'unavailable';
}
