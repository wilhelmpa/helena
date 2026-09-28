'use client';

import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import {
  PageActions,
  PageToolbar,
  PageToolbarSpacer,
  type PageAction,
} from '@/components/layout/PageToolbar';
import type { ServerTab } from '../utils/serverFormat';

// The toolbar of a server settings page: its actions (refresh first). Each former tab is
// a page of Helena's settings of its own; `tab`/`tabs` stay for the callers.
export default function ServerToolbar({
  onRefresh,
  refreshing = false,
  actions = [],
  primary,
  extra,
}: {
  tab: ServerTab;
  tabs: ServerTab[];
  onRefresh?: () => void;
  refreshing?: boolean;
  actions?: PageAction[];
  primary?: Omit<PageAction, 'menuOnly'>;
  extra?: ReactNode;
}) {
  const t = useTranslations('server');
  const all: PageAction[] = [
    ...(onRefresh
      ? [
          {
            id: 'refresh',
            label: refreshing ? t('refreshing') : t('refresh'),
            icon: RefreshCw,
            onClick: onRefresh,
            disabled: refreshing,
          },
        ]
      : []),
    ...actions,
  ];
  return (
    <PageToolbar>
      <PageToolbarSpacer />
      {extra}
      <PageActions actions={all} primary={primary} />
    </PageToolbar>
  );
}
