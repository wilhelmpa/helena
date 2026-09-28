'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { OrganizationDepartment } from '@/lib/api/endpoints/organization';
import BudgetFields from '@/features/autopilot/components/BudgetFields';
import {
  changedBudgets,
  draftFrom,
  type BudgetCellKey,
} from '@/features/autopilot/utils/autopilotFormat';
import { useSetDepartmentBudgets } from '../services/organization.service';

// A department's budgets (hub/pc-costs): tokens, euro or run time per day and month for
// all agents of its projects together. Reaching one throttles them and puts a card in the
// inbox; the org chart shows the fullest one as a bar on the department.
export default function DepartmentBudgets({
  teamId,
  department,
}: {
  teamId: number;
  department: OrganizationDepartment;
}) {
  const t = useTranslations('organization.departments');
  const tAutopilot = useTranslations('autopilot');
  const tCommon = useTranslations('common');
  const budgets = useMemo(() => department.budgets ?? [], [department.budgets]);
  const save = useSetDepartmentBudgets(teamId, department.id);
  const stored = useMemo(() => draftFrom(budgets), [budgets]);
  const [draft, setDraft] = useState<Record<BudgetCellKey, string>>(stored);
  const changes = changedBudgets(budgets, draft);
  const dirty = changes === null || changes.length > 0;

  async function submit() {
    if (changes === null) {
      toast.error(tAutopilot('invalidLimit'));
      return;
    }
    try {
      await save.mutateAsync(changes);
      toast.success(tAutopilot('budgetsSaved'));
    } catch {
      // Surfaced by the global mutation error toast.
    }
  }

  return (
    <div className="ds-department-budgets">
      <span className="ds-mono-label">{t('budgets')}</span>
      <p className="ds-department-budgets-hint">{t('budgetsHint')}</p>
      <div className="ds-department-budgets-fields">
        <BudgetFields
          idPrefix={`department-${department.id}-budget`}
          budgets={budgets}
          draft={draft}
          disabled={save.isPending}
          onChange={(key, value) => setDraft({ ...draft, [key]: value })}
        />
      </div>
      <div className="ds-department-budgets-actions">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => void submit()}
        >
          {save.isPending ? tCommon('saving') : tCommon('save')}
        </Button>
      </div>
    </div>
  );
}
