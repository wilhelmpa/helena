import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CredentialKind } from '@/lib/api/endpoints/credentials';
import { cn } from '@/lib/utils';
import {
  PAGE_CONTROL_CLASS,
  PAGE_PRIMARY_CLASS,
  usePageToolbarRoom,
} from '@/components/layout/PageToolbar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CREDENTIAL_KINDS } from '../../utils/credentialForm';
import { CredentialKindIcon } from './CredentialKindIcon';

// "Add credential", the page's primary action at the end of its toolbar row: it
// opens the four kinds to choose from, so it is a menu rather than PageActions' button.
export function AddCredentialMenu({
  onSelect,
}: {
  onSelect: (kind: CredentialKind | 'mcp_oauth') => void;
}) {
  const t = useTranslations('credentials');
  const tMcp = useTranslations('access.mcp');
  const room = usePageToolbarRoom();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('add')}
          className={cn(
            PAGE_CONTROL_CLASS,
            PAGE_PRIMARY_CLASS,
            room.primaryLabel ? 'px-2.5' : 'w-8 justify-center px-0',
          )}
        >
          <Plus aria-hidden="true" />
          <span className={room.primaryLabel ? undefined : 'sr-only'}>{t('add')}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {CREDENTIAL_KINDS.map((kind) => (
          <DropdownMenuItem
            key={kind}
            className="items-start gap-2.5"
            onSelect={() => onSelect(kind)}
          >
            <CredentialKindIcon kind={kind} className="mt-0.5 size-4 text-muted-foreground" />
            <div className="space-y-0.5">
              <div className="text-sm">{t(`kinds.${kind}`)}</div>
              <div className="text-xs text-muted-foreground">{t(`kindHints.${kind}`)}</div>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem className="items-start gap-2.5" onSelect={() => onSelect('mcp_oauth')}>
          <CredentialKindIcon kind="mcp_oauth" className="mt-0.5 size-4 text-muted-foreground" />
          <div className="space-y-0.5">
            <div className="text-sm">{tMcp('kind')}</div>
            <div className="text-xs text-muted-foreground">{tMcp('kindHint')}</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
