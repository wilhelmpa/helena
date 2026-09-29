'use client';

import { useTranslations } from 'next-intl';
import { helenaSettingsPath } from '@/features/settings/settingsModalCatalog';
import { FigureTile } from '../DashboardParts';
import { useBudgetOverview } from '../useBudgetOverview';
import { budgetTarget } from '../budgetNeedsYou';

// "Budgets" (owner 28.09., Paperclip's budgets, throttle and hard stop): how many projects,
// agents or departments are stopped or slowed by a budget now, and whose. Shown only once a
// budget is set somewhere. Opens where the first of them is changed, else the defaults.
export function BudgetsTile() {
  const t = useTranslations('home.budgets');
  const overview = useBudgetOverview(true);
  if (!overview.isPending && !overview.any) return null;
  const stopped = overview.alerts.filter((alert) => alert.state === 'stopped');
  const throttled = overview.alerts.filter((alert) => alert.state === 'throttled');
  const first = overview.alerts[0];
  const target = first ? budgetTarget(first, overview.teamId) : null;
  const names = [...new Set(overview.alerts.map((alert) => alert.holder.name))];
  return (
    <FigureTile
      label={t('title')}
      value={overview.isPending ? null : overview.alerts.length === 0 ? t('ok') : names.length}
      status={stopped.length > 0 ? 'danger' : throttled.length > 0 ? 'waiting' : undefined}
      subTone={stopped.length > 0 ? 'danger' : throttled.length > 0 ? 'waiting' : 'default'}
      sub={
        stopped.length > 0
          ? t('summaryStopped', { stopped: stopped.length, names: names.join(', ') })
          : throttled.length > 0
            ? t('summaryThrottled', { names: names.join(', ') })
            : t('allWithin')
      }
      title={names.join(', ')}
      href={target?.href ?? (target?.onSelect ? undefined : helenaSettingsPath('defaults'))}
      onSelect={target?.onSelect}
    />
  );
}
