'use client';

import { useTranslations } from 'next-intl';
import CopyableCommand from '@/components/common/page/CopyableCommand';
import StatusBadge from '@/components/common/page/StatusBadge';
import type { RuntimeLoginsHealth } from '@/lib/api/endpoints/god';
import { formatDurationShort } from '@/utils/dates';
import { formatCountdown, KNOWN_PROVIDERS } from '@/features/provider-limits/utils/limitsFormat';
import { useNow } from '@/features/provider-limits/hooks/useNow';
import { loginRows, staleSince } from '../../utils/runtimeLogins';

// The model logins agents share (Hermes' Claude and ChatGPT logins), as the token keeper
// renews them: one 32px line each, and under a login the provider rejected the command that
// signs Hermes in again, to copy into the owner terminal. A report, not a control; nothing
// here but the copy button can be clicked. Nothing without a keeper.
export default function HomeLogins({ health }: { health: RuntimeLoginsHealth | undefined }) {
  const t = useTranslations('god.systemHealth.logins');
  const tp = useTranslations('providerLimits');
  const now = useNow();
  const rows = loginRows(health);
  const since = staleSince(health);
  if (rows.length === 0 && !since) return null;
  const problems = rows.filter((row) => row.needsOwner).length;
  const provider = (id: string) =>
    KNOWN_PROVIDERS.has(id) ? tp(`providers.${id}` as 'providers.anthropic') : id;

  function stateText(row: (typeof rows)[number]): string {
    const { login } = row;
    if (login.store === 'codex-cli' && !login.managed && login.state !== 'invalid') {
      return t('separate');
    }
    if (login.state === 'ok') {
      const left = login.expiresAt && now !== null ? Date.parse(login.expiresAt) - now : null;
      return left !== null && left > 0
        ? t('state.okFor', { time: formatCountdown(left) })
        : t('state.ok');
    }
    return t(`state.${login.state}`);
  }

  return (
    <div className="mt-2">
      <ul className="rounded-lg border bg-card p-1">
        <li className="flex h-8 min-w-0 items-center gap-2 px-2 text-sm">
          <StatusBadge status={problems > 0 ? 'danger' : since ? 'idle' : 'success'} dotOnly />
          <span className="min-w-0 truncate">{t('title')}</span>
          <span className="ms-auto shrink-0 text-xs text-muted-foreground">
            {problems > 0 ? t('summaryProblems', { count: problems }) : t('summaryOk')}
          </span>
        </li>
        {rows.map((row) => (
          <li key={row.key} className="min-w-0">
            <div
              className="flex h-8 min-w-0 items-center gap-2 px-2 text-sm"
              title={row.login.error ?? undefined}
            >
              <StatusBadge status={row.status} dotOnly />
              <span className="min-w-0 truncate">
                {provider(row.login.provider)}
                {row.login.store === 'codex-cli' && (
                  <span className="text-muted-foreground"> · {t('codexCli')}</span>
                )}
              </span>
              <span
                className={
                  row.needsOwner
                    ? 'ms-auto shrink-0 text-xs text-status-danger'
                    : 'ms-auto shrink-0 text-xs text-muted-foreground'
                }
              >
                {stateText(row)}
              </span>
            </div>
            {row.needsOwner && (
              <div className="space-y-1.5 px-2 pb-2">
                {row.login.error && (
                  <p className="text-xs break-words text-muted-foreground">{row.login.error}</p>
                )}
                {row.login.command && (
                  <>
                    <p className="text-xs">
                      {t('relogin', { provider: provider(row.login.provider) })}
                    </p>
                    <CopyableCommand
                      command={row.login.command}
                      copyLabel={t('copyCommand')}
                      copiedLabel={t('copied')}
                    />
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {since && (
        <p className="mt-1 px-2 text-xs text-status-waiting">
          {t('stale', { time: formatDurationShort(since) })}
        </p>
      )}
    </div>
  );
}
