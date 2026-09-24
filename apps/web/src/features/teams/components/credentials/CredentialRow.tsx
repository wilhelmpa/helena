import { FolderGit2, History, MoreHorizontal, Pencil, Trash2, UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CredentialEntry } from '@/lib/api/endpoints/credentials';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CredentialKindIcon } from './CredentialKindIcon';
import { CredentialRowAction } from './CredentialRowAction';

// What identifies a credential without its secret: the account and site of a login, the
// public key of an SSH key.
function detailOf(entry: CredentialEntry): string | null {
  if (entry.kind === 'web_login' && entry.loginUrl) {
    return `${entry.username} · ${new URL(entry.loginUrl).host}`;
  }
  if (entry.kind === 'ssh_key') return entry.publicKey;
  return null;
}

export function CredentialRow({
  entry,
  canManage,
  onOpen,
}: {
  entry: CredentialEntry;
  canManage: boolean;
  onOpen: (dialog: 'edit' | 'grants' | 'audit' | 'delete' | 'clone') => void;
}) {
  const t = useTranslations('credentials');
  const tCommon = useTranslations('common');
  const tAccess = useTranslations('access');
  const detail = detailOf(entry);
  const canClone = canManage && entry.kind === 'ssh_key';

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-background text-muted-foreground">
        <CredentialKindIcon kind={entry.kind} className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{entry.label}</span>
          <Badge variant="secondary" className="text-xs font-normal">
            {t(`kinds.${entry.kind}`)}
          </Badge>
          <Badge variant="outline" className="text-xs font-normal">
            {entry.projectKey ?? t('scopeTeam')}
          </Badge>
        </div>
        {detail && (
          <p dir="ltr" className="truncate font-mono text-xs text-muted-foreground">
            {detail}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {tAccess('grants.count', { count: entry.grants.length })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 max-sm:hidden">
        {canManage && (
          <CredentialRowAction label={t('edit')} onClick={() => onOpen('edit')}>
            <Pencil className="size-4" />
          </CredentialRowAction>
        )}
        {canManage && (
          <CredentialRowAction label={t('grants')} onClick={() => onOpen('grants')}>
            <UsersRound className="size-4" />
          </CredentialRowAction>
        )}
        {canClone && (
          <CredentialRowAction label={tAccess('clone.action')} onClick={() => onOpen('clone')}>
            <FolderGit2 className="size-4" />
          </CredentialRowAction>
        )}
        <CredentialRowAction label={t('audit')} onClick={() => onOpen('audit')}>
          <History className="size-4" />
        </CredentialRowAction>
        {canManage && (
          <CredentialRowAction label={t('delete')} destructive onClick={() => onOpen('delete')}>
            <Trash2 className="size-4" />
          </CredentialRowAction>
        )}
      </div>
      {/* On a phone the four icons would squeeze the name: one "…" menu instead. */}
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
          {canManage && (
            <DropdownMenuItem onSelect={() => onOpen('edit')}>
              <Pencil />
              {t('edit')}
            </DropdownMenuItem>
          )}
          {canManage && (
            <DropdownMenuItem onSelect={() => onOpen('grants')}>
              <UsersRound />
              {t('grants')}
            </DropdownMenuItem>
          )}
          {canClone && (
            <DropdownMenuItem onSelect={() => onOpen('clone')}>
              <FolderGit2 />
              {tAccess('clone.action')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => onOpen('audit')}>
            <History />
            {t('audit')}
          </DropdownMenuItem>
          {canManage && (
            <DropdownMenuItem variant="destructive" onSelect={() => onOpen('delete')}>
              <Trash2 />
              {t('delete')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
