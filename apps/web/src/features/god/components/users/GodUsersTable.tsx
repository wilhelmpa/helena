'use client';

import { Bot, Pencil, Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { InstanceUser } from '@/lib/api/endpoints/god';
import { formatShortDate } from '@/utils/dates';
import Avatar from '@/components/common/Avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useProviderList } from '../../hooks/useProviderList';
import TableCard from '@/components/common/page/TableCard';

import { Inline, Stack, Text, Table, Td, Th, Tr } from '@/design-system';

// The account list. A row (or the pencil in its Actions cell) opens the account in
// the side panel, where the email can be confirmed and the account deleted.
export default function GodUsersTable({
  users,
  onSelect,
}: {
  users: InstanceUser[];
  onSelect: (userId: string) => void;
}) {
  const t = useTranslations('god.users');
  const tCommon = useTranslations('common');
  const providerList = useProviderList();

  return (
    <TableCard>
      <Table stack={false} className="table-fixed xl:min-w-[860px]">
        <colgroup>
          <col className="w-[30%]" />
          <col className="w-[12%]" />
          <col className="w-[15%] max-xl:hidden" />
          <col className="w-[9%] max-md:hidden" />
          <col className="w-[13%] max-xl:hidden" />
          <col className="w-[13%] max-md:hidden" />
          <col className="w-[8%]" />
        </colgroup>
        <thead>
          <Tr className="hover:bg-transparent">
            <Th>{t('columns.account')}</Th>
            <Th>{t('columns.role')}</Th>
            <Th className="max-xl:hidden">{t('columns.signIn')}</Th>
            <Th className="max-md:hidden">{t('columns.projects')}</Th>
            <Th className="max-xl:hidden">{t('columns.lastSeen')}</Th>
            <Th className="max-md:hidden">{t('columns.email')}</Th>
            <Th alignment="end">{tCommon('actions')}</Th>
          </Tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <Tr
              key={u.id}
              className="cursor-pointer"
              onClick={() => onSelect(u.id)}
              title={t('showAccess')}
            >
              <Td className="py-3 align-top whitespace-normal">
                <Inline gap={3} align="start" className="flex min-w-0 items-start">
                  <Avatar name={u.name || u.email} image={u.image} className="size-8 shrink-0" />
                  <Stack gap={1} padTop={1} className="flex min-w-0 flex-col">
                    <Text as="span" size="sm" className="truncate font-medium">
                      {u.name || u.email}
                    </Text>
                    <Text as="span" size="xs" tone="muted" className="truncate">
                      {u.email}
                    </Text>
                    <Text as="span" size="xs" tone="muted">
                      {t('registered', { date: formatShortDate(u.createdAt) })}
                    </Text>
                  </Stack>
                </Inline>
              </Td>

              <Td className="py-3 align-top">
                <Inline gap={1} align="stretch" wrap className="flex flex-wrap">
                  {u.role === 'god' ? (
                    <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-xs font-medium">
                      <Shield className="size-3" />
                      {t('roleGod')}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="px-1.5 py-0 text-xs font-medium">
                      {t('roleUser')}
                    </Badge>
                  )}
                  {u.isAgent && (
                    <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-xs font-medium">
                      <Bot className="size-3" />
                      {t('agent')}
                    </Badge>
                  )}
                </Inline>
              </Td>

              <Td className="py-3 align-top max-xl:hidden">
                {u.providers.length ? providerList(u.providers) : t('noProviders')}
              </Td>

              <Td className="py-3 align-top max-md:hidden">{u.projectCount}</Td>

              <Td className="py-3 align-top max-xl:hidden">
                {u.lastSeenAt ? formatShortDate(u.lastSeenAt) : t('neverSeen')}
              </Td>

              <Td className="py-3 align-top max-md:hidden">
                {u.emailVerified ? (
                  <Badge variant="secondary" className="px-1.5 py-0 text-xs font-medium">
                    {t('verified')}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="px-1.5 py-0 text-xs font-medium">
                    {t('notVerified')}
                  </Badge>
                )}
              </Td>

              <Td alignment="end" className="py-3 align-top">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  aria-label={t('open')}
                  title={t('open')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(u.id);
                  }}
                >
                  <Pencil />
                </Button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableCard>
  );
}
