import { runtimeLoginCondition, type RuntimeLoginCondition } from '@helena/sdk/web';
import type { Status } from '@/components/common/page/StatusBadge';
import type { RuntimeLogin, RuntimeLoginsHealth } from '@/lib/api/endpoints/god';

// How the health overview and Start read the model logins agents share (the token keeper's
// status): by what the owner has to do, not by the access token's countdown (owner,
// 2026-09-24: the logins "sind so kurz gültig" — Claude's access token lasts 8 hours,
// ChatGPT's about 10 days, and the keeper renews both before they run out). One row per
// login, the ones the owner has to act on first, each in the app's one status vocabulary.
//   active        green  "aktiv · erneuert sich automatisch"
//   renewFailing  amber  "Erneuerung klappt gerade nicht · nächster Versuch automatisch"
//   relogin       red    "Neu anmelden" with the owner's command (also in "Braucht dich")
// A report the keeper stopped writing (stale) says so; its logins are shown without a state.

export interface LoginRow {
  key: string;
  login: RuntimeLogin;
  condition: RuntimeLoginCondition;
  // Its report is stale: the keeper stopped writing, so nothing renews it now.
  stale: boolean;
  // The owner signs it in again.
  needsOwner: boolean;
  status: Status;
}

const STATUS: Record<RuntimeLoginCondition, Status> = {
  active: 'success',
  valid: 'success',
  renewFailing: 'waiting',
  relogin: 'danger',
  separate: 'idle',
  unknown: 'idle',
};

export function loginStatus(condition: RuntimeLoginCondition, stale: boolean): Status {
  return stale ? 'idle' : STATUS[condition];
}

export function loginRows(health: RuntimeLoginsHealth | undefined): LoginRow[] {
  if (!health) return [];
  const rows = health.reports.flatMap((report) =>
    report.logins.map((login) => {
      const condition = runtimeLoginCondition(login);
      return {
        key: `${report.source}:${report.reporter}:${login.store}:${login.provider}:${login.id}`,
        login,
        condition,
        stale: report.stale,
        needsOwner: !report.stale && condition === 'relogin',
        status: loginStatus(condition, report.stale),
      } satisfies LoginRow;
    }),
  );
  const rank = (row: LoginRow) =>
    row.needsOwner ? 0 : row.status === 'waiting' ? 1 : row.login.managed ? 2 : 3;
  return rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
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
