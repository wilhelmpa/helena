'use client';

import { useTranslations } from 'next-intl';
import CopyableCommand from '@/components/common/page/CopyableCommand';
import StatusBadge from '@/components/common/page/StatusBadge';
import { Badge } from '@/components/ui/badge';
import type { SharedLogin } from '@/lib/api/endpoints/accessLogins';
import { formatDateTime, formatDurationShort } from '@/utils/dates';
import { KNOWN_PROVIDERS } from '@/features/provider-limits/utils/limitsFormat';
import { CredentialKindIcon } from '@/features/teams/components/credentials/CredentialKindIcon';
import { planLabel, sharedLoginStatus, sharedNeedsOwner } from './loginsView';

// A model login every Hermes agent shares (Claude, ChatGPT), as the token keeper reports it:
// "aktiv · erneuert sich automatisch" while it renews it, and under a login the provider
// refused the command that signs Hermes in again. Nothing to click but the copy button: the
// keeper renews it, the owner only signs it in again.
export function SharedLoginItem({ login }: { login: SharedLogin }) {
  const t = useTranslations('credentials.logins');
  const tLogins = useTranslations('god.systemHealth.logins');
  const tLimits = useTranslations('providerLimits');
  const provider = KNOWN_PROVIDERS.has(login.provider)
    ? tLimits(`providers.${login.provider}` as 'providers.anthropic')
    : login.provider;
  const needsOwner = sharedNeedsOwner(login);
  const state =
    login.condition === 'separate'
      ? tLogins('separate')
      : login.stale
        ? t('keeperSilent')
        : tLogins(`state.${login.condition}`);
  const detail = [
    login.label,
    planLabel(login.plan),
    login.refreshedAt ? t('refreshed', { time: formatDurationShort(login.refreshedAt) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // The access token's own time only as the tooltip: it is short on purpose and renewed.
  const times =
    [
      login.expiresAt ? tLogins('tokenUntil', { time: formatDateTime(login.expiresAt) }) : null,
      t('checkedAt', { time: formatDateTime(login.checkedAt) }),
    ]
      .filter(Boolean)
      .join(' · ') || undefined;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-background text-muted-foreground">
        <CredentialKindIcon kind="runtime_login" className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{provider}</span>
          <Badge variant="secondary" className="text-xs font-normal">
            {login.store === 'codex-cli' ? tLogins('codexCli') : t('sharedHermes')}
          </Badge>
          <StatusBadge status={sharedLoginStatus(login)}>{state}</StatusBadge>
        </div>
        <p className="truncate text-xs text-muted-foreground" title={times}>
          {detail || t('sharedDetail')}
        </p>
        {needsOwner && (
          <div className="space-y-1.5 pt-1">
            {login.error && (
              <p className="text-xs break-words text-muted-foreground">{login.error}</p>
            )}
            {login.command && (
              <>
                <p className="text-xs">{tLogins('relogin', { provider })}</p>
                <CopyableCommand
                  command={login.command}
                  copyLabel={t('copyCommand')}
                  copiedLabel={t('copied')}
                />
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
