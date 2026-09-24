'use client';

import { useTranslations } from 'next-intl';
import { KeyRound, Trash2 } from 'lucide-react';
import { formatDate } from '@/utils/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { passkeyLabel } from '../../utils/authenticators';
import type { PasskeyRow } from '../../services/passkeys.service';

export default function AccountSecurityPasskeyItem({
  passkey,
  onDelete,
}: {
  passkey: PasskeyRow;
  onDelete: () => void;
}) {
  const t = useTranslations('account.security');
  return (
    <Item size="sm" className="rounded-none border-0 px-4 py-2.5">
      <ItemMedia>
        <KeyRound className="size-4" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="flex items-center gap-2">
          {passkeyLabel(passkey, t('passkeyFallback'))}
          {passkey.deviceType === 'singleDevice' && (
            <Badge variant="secondary" className="px-1.5 py-0 text-xs font-normal">
              {t('thisDevice')}
            </Badge>
          )}
        </ItemTitle>
        <ItemDescription>
          {passkey.name ? `${passkey.name} · ` : ''}
          {t('added', { date: formatDate(passkey.createdAt) })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          title={t('removePasskey')}
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </Button>
      </ItemActions>
    </Item>
  );
}
