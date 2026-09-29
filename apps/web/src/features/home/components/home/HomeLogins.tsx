'use client';

import { useTranslations } from 'next-intl';
import CopyableCommand from '@/components/common/page/CopyableCommand';
import StatusBadge from '@/components/common/page/StatusBadge';
import type { RuntimeLoginsHealth } from '@/lib/api/endpoints/god';
import { formatDateTime, formatDurationShort } from '@/utils/dates';
import { KNOWN_PROVIDERS } from '@/features/provider-limits/utils/limitsFormat';
import { loginRows, staleSince } from '../../utils/runtimeLogins';
import { Box, Inline, Stack, Text } from '@/design-system';

// The model logins agents share (Hermes' Claude and ChatGPT logins), by what the owner has
// to do (utils/runtimeLogins): "aktiv · erneuert sich automatisch" while the token keeper
// renews them, amber while a renewal fails for now, and under a login to sign in again the
// command, to copy into the owner terminal. The access token's own time is only the tooltip
// (it is short on purpose and renewed before it runs out). A report, not a control; nothing
// here but the copy button can be clicked. Nothing without a keeper.
export default function HomeLogins({ health }: { health: RuntimeLoginsHealth | undefined }) {
  const t = useTranslations('god.systemHealth.logins');
  const tp = useTranslations('providerLimits');
  const rows = loginRows(health);
  const since = staleSince(health);
  if (rows.length === 0 && !since) return null;
  const problems = rows.filter((row) => row.needsOwner).length;
  const failing = rows.filter((row) => !row.stale && row.condition === 'renewFailing').length;
  const provider = (id: string) =>
    KNOWN_PROVIDERS.has(id) ? tp(`providers.${id}` as 'providers.anthropic') : id;

  function stateText(row: (typeof rows)[number]): string {
    if (row.condition === 'separate') return t('separate');
    return t(`state.${row.condition}`);
  }

  // The access token's time and the last renewal, for the tooltip of a renewed login.
  function tokenTimes(row: (typeof rows)[number]): string | undefined {
    const { login } = row;
    if (row.condition !== 'active') return login.error ?? undefined;
    return (
      [
        login.expiresAt ? t('tokenUntil', { time: formatDateTime(login.expiresAt) }) : null,
        login.refreshedAt ? t('refreshedAt', { time: formatDateTime(login.refreshedAt) }) : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined
    );
  }

  return (
    <Box marginTop={2}>
      <Box as="ul" pad={1} className="rounded-md border bg-card">
        <Inline as="li" gap={2} padX={2} className="h-8 min-w-0 text-sm">
          <StatusBadge
            status={problems > 0 ? 'danger' : since || failing > 0 ? 'waiting' : 'success'}
            dotOnly
          />
          <span className="min-w-0 truncate">{t('title')}</span>
          <Text as="span" size="xs" tone="muted" className="ms-auto shrink-0">
            {problems > 0
              ? t('summaryProblems', { count: problems })
              : since
                ? t('keeperSilent')
                : failing > 0
                  ? t('summaryRenewing', { count: failing })
                  : t('summaryOk')}
          </Text>
        </Inline>
        {rows.map((row) => (
          <li key={row.key} className="min-w-0">
            <Inline gap={2} padX={2} className="h-8 min-w-0 text-sm" title={tokenTimes(row)}>
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
                    ? 'ms-auto min-w-0 truncate text-end text-xs font-medium text-status-danger'
                    : row.status === 'waiting'
                      ? 'ms-auto min-w-0 truncate text-end text-xs text-status-waiting'
                      : 'ms-auto min-w-0 truncate text-end text-xs text-muted-foreground'
                }
              >
                {stateText(row)}
              </span>
            </Inline>
            {row.needsOwner && (
              <Stack gap={2} padX={2} padBottom={2}>
                {row.login.error && (
                  <Text as="p" size="xs" tone="muted" className="break-words">
                    {row.login.error}
                  </Text>
                )}
                {row.login.command && (
                  <>
                    <Text as="p" size="xs">
                      {t('relogin', { provider: provider(row.login.provider) })}
                    </Text>
                    <CopyableCommand
                      command={row.login.command}
                      copyLabel={t('copyCommand')}
                      copiedLabel={t('copied')}
                    />
                  </>
                )}
              </Stack>
            )}
          </li>
        ))}
      </Box>
      {since && (
        <Text as="p" size="xs" tone="warning" className="mt-1 px-2">
          {t('stale', { time: formatDurationShort(since) })}
        </Text>
      )}
    </Box>
  );
}
