'use client';

import { Bot, UserRound, UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { InstanceUserKind } from '@/lib/api/endpoints/god';
import {
  PageSearch,
  PageTabs,
  PageToolbar,
  PageToolbarSpacer,
} from '@/components/layout/PageToolbar';

// The directory's kind filter (people, agents, everyone) and its search, in the
// header's one toolbar row. Both drive server-side queries, so a change here
// refetches a page rather than filtering what is on screen.
export default function GodUsersToolbar({
  search,
  onSearchChange,
  kind,
  onKindChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  kind: InstanceUserKind;
  onKindChange: (value: InstanceUserKind) => void;
}) {
  const t = useTranslations('god.users');

  return (
    <PageToolbar>
      <PageTabs<InstanceUserKind>
        label={t('kind')}
        value={kind}
        onChange={onKindChange}
        items={[
          { value: 'human', label: t('kinds.human'), icon: UserRound },
          { value: 'agent', label: t('kinds.agent'), icon: Bot },
          { value: 'all', label: t('kinds.all'), icon: UsersRound },
        ]}
      />
      <PageToolbarSpacer />
      <PageSearch value={search} onChange={onSearchChange} placeholder={t('searchPlaceholder')} />
    </PageToolbar>
  );
}
