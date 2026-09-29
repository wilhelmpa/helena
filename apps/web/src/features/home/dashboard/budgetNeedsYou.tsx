'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Wallet } from 'lucide-react';
import type { NeedsYouEntry, NeedsYouSource } from '@/extensions/needsYouSources';
import { formatBudgetAmount } from '@/features/autopilot/utils/autopilotFormat';
import { openAgent } from '@/features/settings/settingsModalCatalog';
import { helenaSettingsPath } from '@/features/settings/settingsModalCatalog';
import { settingsPath } from '@/utils/paths';
import type { BudgetAlert } from './budgetAlerts';
import { useBudgetOverview } from './useBudgetOverview';

// Where a budget is changed: a project's in its settings (Autopilot & Ausführung), an
// agent's in its dialog, a department's under Organisation.
export function budgetTarget(
  alert: BudgetAlert,
  teamId: number | null,
): Pick<NeedsYouEntry, 'href' | 'onSelect'> {
  const { holder } = alert;
  if (holder.scope === 'project' && holder.projectKey)
    return { href: settingsPath(holder.projectKey, 'autopilot') };
  if (holder.scope === 'agent')
    return { onSelect: () => openAgent(holder.id, teamId ?? undefined, 'settings') };
  return { href: helenaSettingsPath('organization', 'departments') };
}

// "Braucht dich" (owner 28.09., the budgets of Paperclip): a used-up budget stops the work
// of its project, agent or department until the owner raises it — a red problem while it
// lasts. Budgets that only slow the heartbeats show on Start's budget tile.
function useBudgetEntries({ owner }: { owner: boolean }): {
  entries: NeedsYouEntry[];
  isPending: boolean;
} {
  const t = useTranslations('home.budgets');
  const tAutopilot = useTranslations('autopilot');
  const locale = useLocale();
  const overview = useBudgetOverview(owner);
  if (!owner) return { entries: [], isPending: false };
  return {
    entries: overview.alerts
      .filter((alert) => alert.state === 'stopped')
      .map((alert) => ({
        key: alert.key,
        kind: 'problem',
        at: alert.budget.periodStart,
        icon: Wallet,
        title: t(`stopped.${alert.holder.scope}`, { name: alert.holder.name }),
        detail: [
          `${tAutopilot(`metric.${alert.budget.metric}`)} ${tAutopilot(`period.${alert.budget.period}`)}`,
          tAutopilot('usedOf', {
            used: formatBudgetAmount(alert.budget.metric, alert.budget.used, locale),
            limit: formatBudgetAmount(alert.budget.metric, alert.budget.limit, locale),
          }),
        ].join(' · '),
        projectKey: alert.holder.projectKey ?? null,
        ...budgetTarget(alert, overview.teamId),
      })),
    isPending: false,
  };
}

export const budgetNeedsYouSource: NeedsYouSource = {
  id: 'budgets',
  order: 19,
  useEntries: useBudgetEntries,
};
