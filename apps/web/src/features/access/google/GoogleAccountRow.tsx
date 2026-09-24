'use client';

import {
  ArrowRightLeft,
  History,
  LogIn,
  MoreHorizontal,
  RefreshCw,
  Settings2,
  Trash2,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import StatusBadge from '@/components/common/page/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { GoogleAccount } from '@/lib/api/endpoints/access';
import { CredentialRowAction } from '@/features/teams/components/credentials/CredentialRowAction';
import { accountStatus } from './googleLabels';

export type GoogleRowAction =
  'check' | 'services' | 'grants' | 'audit' | 'signIn' | 'move' | 'remove';

// One Google account: its address, where the sign-in is kept, its health, the services
// switched on and its mailbox, with the owner's actions.
export function GoogleAccountRow({
  account,
  canManage,
  busy,
  onAction,
}: {
  account: GoogleAccount;
  canManage: boolean;
  busy: boolean;
  onAction: (action: GoogleRowAction) => void;
}) {
  const t = useTranslations('access.google');
  const tCommon = useTranslations('common');
  const tCredentials = useTranslations('credentials');
  const status = accountStatus(account);
  const services = account.services.filter((service) => service.enabled);
  const mailbox = !account.mail
    ? null
    : !account.mail.enabled
      ? t('mailboxOff')
      : account.mail.fetchDays == null
        ? t('mailboxAll')
        : t('mailbox', { days: account.mail.fetchDays });

  const actions: {
    id: GoogleRowAction;
    label: string;
    icon: LucideIcon;
    show: boolean;
    destructive?: boolean;
  }[] = [
    { id: 'check', label: t('check'), icon: RefreshCw, show: true },
    { id: 'services', label: t('editServices'), icon: Settings2, show: canManage },
    { id: 'grants', label: t('access'), icon: UsersRound, show: canManage },
    { id: 'audit', label: tCredentials('audit'), icon: History, show: true },
    {
      id: 'signIn',
      label: t('signInAgain'),
      icon: LogIn,
      show: canManage && account.engine === 'helena',
    },
    {
      id: 'move',
      label: t('moveToHelena'),
      icon: ArrowRightLeft,
      show: canManage && account.engine === 'gog',
    },
    { id: 'remove', label: t('remove'), icon: Trash2, show: canManage, destructive: true },
  ];
  const visible = actions.filter((action) => action.show);

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span dir="ltr" className="truncate text-sm font-medium">
            {account.email}
          </span>
          <StatusBadge status={status.dot}>{t(`status.${status.key}`)}</StatusBadge>
          {account.engine === 'gog' && (
            <Badge variant="outline" className="text-xs font-normal">
              {t('engine.gog')}
            </Badge>
          )}
          {account.projectKey && (
            <Badge variant="outline" className="text-xs font-normal">
              {account.projectKey}
            </Badge>
          )}
        </div>
        {services.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {services.map((service) => (
              <Badge
                key={service.id}
                variant={service.granted ? 'secondary' : 'outline'}
                className="text-xs font-normal"
              >
                {t(`services.${service.id}`)}
              </Badge>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {[mailbox, account.statusDetail].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 max-sm:hidden">
        {visible.map((action) => (
          <CredentialRowAction
            key={action.id}
            label={action.label}
            destructive={action.destructive}
            onClick={() => onAction(action.id)}
          >
            <action.icon
              className={busy && action.id === 'check' ? 'size-4 animate-spin' : 'size-4'}
            />
          </CredentialRowAction>
        ))}
      </div>
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
        <DropdownMenuContent align="end" className="min-w-48">
          {visible.map((action) => (
            <DropdownMenuItem
              key={action.id}
              variant={action.destructive ? 'destructive' : undefined}
              onSelect={() => onAction(action.id)}
            >
              <action.icon />
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
