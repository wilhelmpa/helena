import { History, Pencil, Trash2, UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CredentialEntry } from '@/lib/api/endpoints/credentials';
import { Badge } from '@/components/ui/badge';
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
  onOpen: (dialog: 'edit' | 'grants' | 'audit' | 'delete') => void;
}) {
  const t = useTranslations('credentials');
  const detail = detailOf(entry);

  return (
    <li className="flex items-start gap-3 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
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
          {t('agentCount', { count: entry.agentIds.length })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
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
        <CredentialRowAction label={t('audit')} onClick={() => onOpen('audit')}>
          <History className="size-4" />
        </CredentialRowAction>
        {canManage && (
          <CredentialRowAction label={t('delete')} destructive onClick={() => onOpen('delete')}>
            <Trash2 className="size-4" />
          </CredentialRowAction>
        )}
      </div>
    </li>
  );
}
