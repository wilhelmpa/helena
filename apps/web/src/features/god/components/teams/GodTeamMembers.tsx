'use client';

import { Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatShortDate } from '@/utils/dates';
import { useSearchTerm } from '@/hooks/useSearchTerm';
import Avatar from '@/components/common/Avatar';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { EmptyState } from '@/components/common/page/EmptyState';
import SearchInput from '@/components/common/SearchInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useInstanceTeamMembersQuery } from '../../services/god.service';

import { Inline, Text, Stack } from '@/design-system';

// Everyone in the team, people and agents alike, a page at a time. The rank is the
// fixed team one, so there is no permission matrix to unfold behind the row.
export default function GodTeamMembers({ teamId }: { teamId: number }) {
  const t = useTranslations('god.teamPanel');
  const tCommon = useTranslations('common');
  const { search, setSearch, term } = useSearchTerm();

  const membersQuery = useInstanceTeamMembersQuery(teamId, term);
  const members = membersQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const total = membersQuery.data?.pages[0]?.total ?? 0;

  return (
    <Stack as="section" gap={3}>
      <Inline gap={2} className="flex items-center">
        <h3 className="text-sm font-medium">{t('members')}</h3>
        {total > 0 && (
          <Text as="span" size="xs" tone="muted">
            {total}
          </Text>
        )}
      </Inline>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={t('searchMembers')}
        className="w-full"
      />

      {membersQuery.isPending ? (
        <ListSkeleton rows={4} rowClassName="h-12" />
      ) : members.length === 0 ? (
        <EmptyState
          title={t('noMembersTitle')}
          description={term ? t('noMemberMatches') : t('noMembersHint')}
        />
      ) : (
        <>
          <Stack gap={2}>
            {members.map((m) => (
              <Inline
                gap={3}
                padX={3}
                padY={3}
                key={m.userId}
                className="flex items-center rounded-md border border-sidebar-border bg-card"
              >
                <Avatar name={m.name || m.email} image={m.image} className="size-8 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <Text as="span" size="sm" className="truncate">
                    {m.name || m.email}
                  </Text>
                  <Text as="span" size="xs" tone="muted" className="truncate">
                    {m.email}
                  </Text>
                </div>
                <Badge
                  variant={m.role === 'owner' ? 'default' : 'secondary'}
                  className="gap-1 px-1.5 py-0 text-xs font-medium"
                >
                  {m.isAgent && <Bot className="size-3" />}
                  {t(`roles.${m.role}`)}
                </Badge>
                <Text as="span" size="xs" tone="muted" className="hidden sm:inline">
                  {t('joined', { date: formatShortDate(m.joinedAt) })}
                </Text>
              </Inline>
            ))}
          </Stack>
          {membersQuery.hasNextPage && (
            <Button
              variant="outline"
              className="w-full"
              disabled={membersQuery.isFetchingNextPage}
              onClick={() => void membersQuery.fetchNextPage()}
            >
              {tCommon('showMore')}
            </Button>
          )}
        </>
      )}
    </Stack>
  );
}
