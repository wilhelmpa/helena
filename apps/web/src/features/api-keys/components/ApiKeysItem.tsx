'use client';

import { KeyRound, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatShortDate } from '@/utils/dates';
import { Button } from '@/components/ui/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import type { ApiKeyRow } from '../services/apiKeys.service';

export default function ApiKeysItem({
  apiKey,
  onDelete,
}: {
  apiKey: ApiKeyRow;
  onDelete: () => void;
}) {
  const t = useTranslations('apiKeys');

  return (
    <Item size="sm" className="rounded-none border-0 px-4 py-2.5">
      <ItemMedia>
        <KeyRound className="size-4" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{apiKey.name ?? t('fallbackName')}</ItemTitle>
        <ItemDescription>
          {apiKey.start ? `${apiKey.start}… · ` : ''}
          {t('createdAt', { date: formatShortDate(apiKey.createdAt) })}
          {' · '}
          {apiKey.expiresAt
            ? t('expiresAt', { date: formatShortDate(apiKey.expiresAt) })
            : t('noExpiry')}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          title={t('deleteAction')}
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </Button>
      </ItemActions>
    </Item>
  );
}
