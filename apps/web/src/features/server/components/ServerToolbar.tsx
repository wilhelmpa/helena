'use client';

import { Activity, Archive, Cpu, HardDrive, PackageCheck, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import {
  PageActions,
  PageTabs,
  PageToolbar,
  PageToolbarSpacer,
  type PageAction,
} from '@/components/layout/PageToolbar';
import { serverPath } from '@/utils/paths';
import type { ServerTab } from '../utils/serverFormat';

const ICONS = {
  overview: Activity,
  disks: HardDrive,
  backup: Archive,
  power: Cpu,
  updates: PackageCheck,
} as const;

// The Server area's one header row: its tabs, then the tab's own actions (refresh first).
export default function ServerToolbar({
  tab,
  tabs,
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
      <PageTabs
        label={t('title')}
        value={tab}
        items={tabs.map((value) => ({
          value,
          label: t(`areas.${value}`),
          icon: ICONS[value],
          href: serverPath(value),
        }))}
      />
      <PageToolbarSpacer />
      {extra}
      <PageActions actions={all} primary={primary} />
    </PageToolbar>
  );
}
