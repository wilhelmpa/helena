import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CredentialKind } from '@/lib/api/endpoints/credentials';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CREDENTIAL_KINDS } from '../../utils/credentialForm';
import { CredentialKindIcon } from './CredentialKindIcon';

export function AddCredentialMenu({ onSelect }: { onSelect: (kind: CredentialKind) => void }) {
  const t = useTranslations('credentials');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="h-8 gap-1.5">
          <Plus className="size-3.5" />
          {t('add')}
        </Button>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
