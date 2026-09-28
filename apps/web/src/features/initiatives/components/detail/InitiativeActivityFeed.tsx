'use client';

import { useTranslations } from 'next-intl';
import { useInitiativeFeedQuery } from '@/services/initiatives.service';
import ShowMoreButton from '@/components/common/ShowMoreButton';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import InitiativeFeedRow from './InitiativeFeedRow';
import { Stack, Text } from '@/design-system';

// The initiative's activity: its own events plus its linked issues' activity, one
// feed paged newest first.
export default function InitiativeActivityFeed({
  initiativeId,
  projectKey,
}: {
  initiativeId: number;
  projectKey: string;
}) {
  const t = useTranslations('initiatives');
  const feed = useInitiativeFeedQuery(initiativeId);

  // Pages can overlap when new activity shifts the offset, so drop repeated ids.
  const byId = new Map((feed.data?.pages ?? []).flatMap((p) => p.items).map((it) => [it.id, it]));
  const items = [...byId.values()];

  if (feed.isLoading) return <ListSkeleton rows={3} rowClassName="h-12" />;

  if (items.length === 0)
    return (
      <Text as="p" size="sm" tone="muted">
        {t('noActivity')}
      </Text>
    );

  return (
    <>
      <Stack as="ul" gap={3}>
        {items.map((item) => (
          <InitiativeFeedRow key={item.id} item={item} projectKey={projectKey} />
        ))}
      </Stack>
      {feed.hasNextPage && (
        <ShowMoreButton
          loading={feed.isFetchingNextPage}
          onClick={() => void feed.fetchNextPage()}
        />
      )}
    </>
  );
}
