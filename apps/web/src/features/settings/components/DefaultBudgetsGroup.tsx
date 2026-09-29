'use client';

import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { DefaultBudget, ProjectDefaults } from '@/lib/api/endpoints/projects';
import { getProjectAutopilot, type BudgetStatus } from '@/lib/api/endpoints/autopilot';
import { qk } from '@/services/queryKeys';
import { useProjectsQuery } from '@/services/projects.service';
import BudgetFields from '@/features/autopilot/components/BudgetFields';
import {
  BUDGET_CELLS,
  draftFrom,
  inputToLimit,
  type BudgetCellKey,
} from '@/features/autopilot/utils/autopilotFormat';
import { budgetsMatchDefaults } from '@/features/autopilot/utils/budgetDefaults';
import { useUpdateInstanceProjectDefaults } from '@/features/god/services/god.service';
import { SettingsGroup, SettingsRow } from '@/design-system';

// The budgets a new project starts with (Vorgaben für Projekte; owner 28.09., Paperclip's
// budgets): tokens, euros and hours per day and month. A project changes its own; the
// line under the fields counts the projects whose budgets differ.
export default function DefaultBudgetsGroup({ defaults }: { defaults: ProjectDefaults }) {
  const t = useTranslations('settings.defaults');
  const tAutopilot = useTranslations('autopilot');
  const update = useUpdateInstanceProjectDefaults();
  const stored = useMemo(
    () => draftFrom(defaults.budgets.map((budget) => ({ ...budget }) as unknown as BudgetStatus)),
    [defaults.budgets],
  );
  const [draft, setDraft] = useState<Record<BudgetCellKey, string>>(stored);
  const projects = (useProjectsQuery().data ?? []).filter(
    (project) => project.projectRole !== 'home',
  );
  const autopilots = useQueries({
    queries: projects.map((project) => ({
      queryKey: qk.projectAutopilot(project.key),
      queryFn: () => getProjectAutopilot(project.key),
      staleTime: 60_000,
    })),
  });
  const overridden = autopilots.filter(
    (query) => query.data && !budgetsMatchDefaults(query.data.budgets, defaults.budgets),
  ).length;

  function next(): DefaultBudget[] | null {
    const budgets: DefaultBudget[] = [];
    for (const { metric, period, key } of BUDGET_CELLS) {
      const limit = inputToLimit(metric, draft[key] ?? '');
      if (limit === undefined) return null;
      if (limit !== null) budgets.push({ metric, period, limit });
    }
    return budgets;
  }

  async function save() {
    const budgets = next();
    if (budgets === null) {
      toast.error(tAutopilot('invalidLimit'));
      return;
    }
    if (BUDGET_CELLS.every(({ key }) => (draft[key] ?? '').trim() === stored[key])) return;
    try {
      await update.mutateAsync({ ...defaults, budgets });
      toast.success(t('budgetsSaved'));
    } catch {
      // Surfaced by the global mutation error toast.
    }
  }

  return (
    <SettingsGroup title={t('budgetsTitle')} description={t('budgetsHint')}>
      <BudgetFields
        idPrefix="default-budget"
        budgets={[]}
        draft={draft}
        disabled={update.isPending}
        onChange={(key, value) => setDraft({ ...draft, [key]: value })}
        onBlur={() => void save()}
      />
      <SettingsRow
        label={overridden > 0 ? t('budgetsOverridden', { count: overridden }) : t('budgetsNone')}
      />
    </SettingsGroup>
  );
}
