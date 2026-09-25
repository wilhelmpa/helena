'use client';

import { useTranslations } from 'next-intl';
import { Laptop, MoreHorizontal, Send, Smartphone, Trash2 } from 'lucide-react';
import type { PushDevice, PushOverview } from '@/lib/api/endpoints/push';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { formatDateTime } from '@/utils/dates';
import AccountSection from '@/features/account/components/AccountSection';
import { usePushMutations } from '../services/push.service';
import { useCategoryText } from '../utils/categoryText';
import { pushServiceOf } from '../utils/deviceLabel';

const PHONES = /iPhone|iPad|Android/;

// Konto → Benachrichtigungen, "Deine Geräte": every device of the person that receives
// pushes, what it receives, whether the last message arrived; per device its categories, a
// test message and removing it.
export default function PushDevicesSection({
  overview,
  currentId,
  onTest,
}: {
  overview: PushOverview | undefined;
  currentId: number | undefined;
  onTest: (device: PushDevice) => void;
}) {
  const t = useTranslations('account.notifications.devices');
  const tService = useTranslations('account.notifications.services');
  const text = useCategoryText();
  const { update, remove } = usePushMutations();
  const devices = overview?.devices ?? [];
  const categories = overview?.categories ?? [];

  return (
    <AccountSection title={t('title')} description={t('description')} flush>
      {devices.length === 0 && (
        <p className="px-4 py-3 text-sm text-muted-foreground">{t('empty')}</p>
      )}
      {devices.map((device) => {
        const name = device.label || t('unnamed');
        const Icon = PHONES.test(device.label || device.userAgent) ? Smartphone : Laptop;
        const service = pushServiceOf(device.service);
        const on = categories
          .filter((category) => device.categories[category.id])
          .map((category) => text(category.label));
        const failing = device.failureCount > 0 && device.lastError;
        const meta = [
          service === 'other' ? device.service : tService(service),
          on.length > 0 ? on.join(', ') : t('noneOn'),
          device.lastSuccessAt
            ? t('lastDelivered', { when: formatDateTime(device.lastSuccessAt) })
            : null,
        ].filter(Boolean);
        return (
          <Item key={device.id} size="sm" className="rounded-none border-0 px-4 py-2.5">
            <ItemMedia>
              <Icon className="size-4" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="flex items-center gap-2">
                {name}
                {device.id === currentId && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-xs font-normal">
                    {t('thisDevice')}
                  </Badge>
                )}
              </ItemTitle>
              <ItemDescription>{meta.join(' · ')}</ItemDescription>
              {!device.currentKey && (
                <ItemDescription className="text-destructive">{t('resubscribe')}</ItemDescription>
              )}
              {failing && (
                <ItemDescription className="text-destructive">
                  {t('failing', { error: device.lastError ?? '' })}
                </ItemDescription>
              )}
            </ItemContent>
            <ItemActions>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    aria-label={t('menu', { name })}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {t('receives')}
                  </DropdownMenuLabel>
                  {categories.map((category) => (
                    <DropdownMenuCheckboxItem
                      key={category.id}
                      checked={device.categories[category.id] === true}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={(checked) =>
                        update.mutate({ id: device.id, categories: { [category.id]: checked } })
                      }
                    >
                      {text(category.label)}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onTest(device)}>
                    <Send className="size-4" />
                    {t('test')}
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate(device.id)}>
                    <Trash2 className="size-4" />
                    {t('remove')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ItemActions>
          </Item>
        );
      })}
    </AccountSection>
  );
}
