import type { Status } from '@/components/common/page/StatusBadge';
import type { RuntimeLogin, RuntimeLoginsHealth } from '@/lib/api/endpoints/god';

// How the health overview reads the model logins agents share (the token keeper's status):
// one row per login, the ones the owner has to act on first, each in the app's one status
// vocabulary (StatusBadge).

export interface LoginRow {
  key: string;
  login: RuntimeLogin;
  // Its report is stale: the keeper stopped writing, so nothing renews it now.
  stale: boolean;
  // Rejected, or renewed and not usable: the owner signs it in again (or looks at why).
  needsOwner: boolean;
  status: Status;
}

export function loginNeedsOwner(login: Pick<RuntimeLogin, 'state' | 'managed'>): boolean {
  if (login.state === 'invalid') return true;
  return login.managed && (login.state === 'expired' || login.state === 'error');
}

export function loginStatus(
  login: Pick<RuntimeLogin, 'state' | 'managed'>,
  stale: boolean,
): Status {
  if (loginNeedsOwner(login)) return 'danger';
  if (stale || login.state === 'unknown' || login.state === 'expired') return 'idle';
  if (login.state === 'expiring' || login.state === 'error') return 'waiting';
  return 'success';
}

export function loginRows(health: RuntimeLoginsHealth | undefined): LoginRow[] {
  if (!health) return [];
  const rows = health.reports.flatMap((report) =>
    report.logins.map((login) => {
      const needsOwner = !report.stale && loginNeedsOwner(login);
      return {
        key: `${report.source}:${report.reporter}:${login.store}:${login.provider}:${login.id}`,
        login,
        stale: report.stale,
        needsOwner,
        status: report.stale && !needsOwner ? 'idle' : loginStatus(login, report.stale),
      } satisfies LoginRow;
    }),
  );
  return rows.sort(
    (a, b) =>
      Number(b.needsOwner) - Number(a.needsOwner) ||
      Number(b.login.managed) - Number(a.login.managed) ||
      a.login.provider.localeCompare(b.login.provider) ||
      a.login.store.localeCompare(b.login.store),
  );
}

// The oldest time a stale reporter last wrote, if any stopped.
export function staleSince(health: RuntimeLoginsHealth | undefined): string | null {
  const stale = (health?.reports ?? []).filter((report) => report.stale);
  if (stale.length === 0) return null;
  return stale.map((report) => report.checkedAt).sort()[0] ?? null;
}
