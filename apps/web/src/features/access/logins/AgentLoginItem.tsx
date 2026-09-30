'use client';

import { IconTile } from '@/design-system';
import { useState } from 'react';
import { KeyRound, LogIn, LogOut, MoreHorizontal, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import CopyableCommand from '@/components/common/page/CopyableCommand';
import StatusBadge from '@/components/common/page/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AgentLogin } from '@/lib/api/endpoints/accessLogins';
import { cn } from '@/lib/utils';
import { formatDateTime, formatDurationShort } from '@/utils/dates';
import { CredentialKindIcon } from '@/features/teams/components/credentials/CredentialKindIcon';
import { CredentialRowAction } from '@/features/teams/components/credentials/CredentialRowAction';
import { agentLoginStatus, agentNeedsOwner, planLabel } from './loginsView';

// How the runtime names the ways it signs in.
const METHODS = new Set(['chatgpt', 'api-key', 'claude.ai', 'console', 'oauth_token']);

// One Claude Code or Codex agent's login: its own in its home (a Codex device login, with
// the account's e-mail and plan and when the runtime last renewed it), or the stored one
// granted to it, or none. "Neu anmelden" shows the command for the owner terminal,
// "Prüfen" has the runner look now, "Abmelden" signs the runtime's own login out.
export function AgentLoginItem({
  login,
  canManage,
  highlighted,
  checking,
  onCheck,
  onSignOut,
  onAddRuntimeLogin,
}: {
  login: AgentLogin;
  canManage: boolean;
  highlighted: boolean;
  checking: boolean;
  onCheck: () => void;
  onSignOut: () => void;
  onAddRuntimeLogin?: () => void;
}) {
  const t = useTranslations('credentials.logins');
  const tRuntime = useTranslations('credentials.runtimeLogin');
  const tCommon = useTranslations('common');
  const needsOwner = agentNeedsOwner(login);
  // A login the owner has to make shows its command anyway; "Neu anmelden" opens it for one
  // that works.
  const [expanded, setExpanded] = useState(false);
  const showCommand = (expanded || needsOwner) && !!login.command;
  const account = login.account;

  const method =
    account?.method && METHODS.has(account.method)
      ? t(`methods.${account.method.replace('.', '_')}` as 'methods.chatgpt')
      : account?.method;
  const detail =
    login.source === 'stored' && login.credential
      ? t('viaCredential', { label: login.credential.label })
      : login.source === 'own' && account
        ? [
            account.email,
            planLabel(account.plan),
            account.email || account.plan ? null : method,
            account.organization,
            login.refreshedAt ? renewedText(login.refreshedAt) : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : login.state === 'unknown'
          ? t('notReported')
          : t('noLogin');
  function renewedText(at: string): string {
    return Date.now() - Date.parse(at) < 60_000
      ? t('refreshedNow')
      : t('refreshed', { time: formatDurationShort(at) });
  }
  const checked = login.checkedAt
    ? t('checkedAt', { time: formatDateTime(login.checkedAt) })
    : undefined;
  const canCheck = canManage && login.canCheck;

  return (
    <li
      id={`login-agent-${login.agentId}`}
      className={cn('flex items-start gap-3 px-4 py-3', highlighted && 'bg-accent/50')}
    >
      <IconTile>
        <CredentialKindIcon kind="runtime_login" className="size-4" />
      </IconTile>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{login.name}</span>
          <Badge variant="secondary" className="text-xs font-normal">
            {tRuntime(`runtimes.${login.runtime}`)}
          </Badge>
          <StatusBadge status={agentLoginStatus(login)}>{t(`state.${login.state}`)}</StatusBadge>
          {!login.online && (
            <Badge variant="outline" className="text-xs font-normal">
              {t('offline')}
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground" title={checked}>
          {detail}
        </p>
        {showCommand && (
          <div className="space-y-1.5 pt-1">
            <p className="text-xs text-muted-foreground">{t(`signIn.${login.runtime}`)}</p>
            <CopyableCommand
              command={login.command!}
              copyLabel={t('copyCommand')}
              copiedLabel={t('copied')}
            />
            {login.runtime === 'claude' && canManage && onAddRuntimeLogin && (
              <Button type="button" size="sm" variant="outline" onClick={onAddRuntimeLogin}>
                <KeyRound />
                {t('addRuntimeLogin')}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 max-sm:hidden">
        {canCheck && (
          <CredentialRowAction label={t('check')} onClick={onCheck}>
            <RefreshCw className={cn('size-4', checking && 'animate-spin')} />
          </CredentialRowAction>
        )}
        {login.command && !needsOwner && (
          <CredentialRowAction label={t('signInAgain')} onClick={() => setExpanded(!expanded)}>
            <LogIn className="size-4" />
          </CredentialRowAction>
        )}
        {login.canSignOut && (
          <CredentialRowAction label={t('signOut')} destructive onClick={onSignOut}>
            <LogOut className="size-4" />
          </CredentialRowAction>
        )}
      </div>
      {(canCheck || (login.command && !needsOwner) || login.canSignOut) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground sm:hidden"
              aria-label={tCommon('more')}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {canCheck && (
              <DropdownMenuItem onSelect={onCheck} disabled={checking}>
                <RefreshCw />
                {t('check')}
              </DropdownMenuItem>
            )}
            {login.command && !needsOwner && (
              <DropdownMenuItem onSelect={() => setExpanded(!expanded)}>
                <LogIn />
                {t('signInAgain')}
              </DropdownMenuItem>
            )}
            {login.canSignOut && (
              <DropdownMenuItem variant="destructive" onSelect={onSignOut}>
                <LogOut />
                {t('signOut')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
