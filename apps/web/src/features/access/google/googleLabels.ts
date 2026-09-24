import type { Status } from '@/components/common/page/StatusBadge';
import type { GoogleAccount } from '@/lib/api/endpoints/access';

// The status dot of an account: connected, waiting for a new sign-in, or broken.
export function accountStatus(account: Pick<GoogleAccount, 'status'>): {
  dot: Status;
  key: 'ok' | 'needs_auth' | 'error' | 'unknown';
} {
  switch (account.status) {
    case 'ok':
      return { dot: 'success', key: 'ok' };
    case 'needs_auth':
      return { dot: 'waiting', key: 'needs_auth' };
    case 'error':
      return { dot: 'danger', key: 'error' };
    default:
      return { dot: 'idle', key: 'unknown' };
  }
}
