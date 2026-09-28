'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import type { AutopilotLevel } from '@/lib/api/endpoints/autopilot';
import {
  useProjectAutopilot,
  useSetProjectBudgets,
  useSetProjectLevel,
} from '@/services/autopilot.service';
import { inputToLimit } from '@/features/autopilot/utils/autopilotFormat';
import SectionPageView from '@/components/common/page/SectionPageView';
import { ButtonLink, Segmented, SettingsGroup, SettingsRow, TextField } from '@/design-system';
import { organizationPath } from '@/utils/paths';
import { helenaSettingsPath } from './settingsModalCatalog';

// Project-level controls remain on the existing Autopilot and budget API. The other
// values in the design belong to agents or the instance in today's data model, so
// their rows lead to the existing editor that owns them.
export default function ProjectAgentsExecutionPage() {
  const t = useTranslations('settings.execution');
  const tNav = useTranslations('nav');
  const { project } = useShell();
  const { can } = usePermissions();
  const projectKey = project?.project.key ?? '';
  const editable = can('ai_agents', 'edit');
  const autopilot = useProjectAutopilot(projectKey);
  const setLevel = useSetProjectLevel(projectKey);
  const setBudgets = useSetProjectBudgets(projectKey);
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const dayCost = autopilot.data?.budgets.find(
    (item) => item.metric === 'cost' && item.period === 'day',
  );
  const budgetValue =
    budgetDraft ?? (dayCost?.limit == null ? '' : dayCost.limit.toFixed(2).replace('.', ','));

  async function saveBudget() {
    if (budgetDraft === null) return;
    const limit = inputToLimit('cost', budgetDraft);
    if (limit === undefined) {
      toast.error(t('budgetInvalid'));
      setBudgetDraft(null);
      return;
    }
    if (limit === (dayCost?.limit ?? null)) {
      setBudgetDraft(null);
      return;
    }
    try {
      await setBudgets.mutateAsync([{ metric: 'cost', period: 'day', limit }]);
      setBudgetDraft(null);
      toast.success(t('budgetSaved'));
    } catch {
      // The global mutation handler shows the API error.
    }
  }

  if (!project) return null;
  const team = organizationPath(project.project.key);
  const level = autopilot.data?.level;
  return (
    <SectionPageView title={tNav('settingsExecution')}>
      <div className="ds-stack">
        <SettingsGroup title={t('title')} description={t('note')}>
          <SettingsRow label={t('defaultLabel')} description={t('defaultHint')}>
            <ButtonLink href={team} size="small">
              {t('manageAgents')}
            </ButtonLink>
          </SettingsRow>
          <SettingsRow label={t('levelLabel')} description={t('levelHint')}>
            <Segmented<string>
              label={t('levelLabel')}
              value={level == null ? '' : String(level)}
              options={(['0', '1', '2', '3'] as const).map((value) => ({ value, label: value }))}
              onChange={(value) => {
                if (!editable || !autopilot.data || setLevel.isPending) return;
                void setLevel
                  .mutateAsync(Number(value) as AutopilotLevel)
                  .then(() => toast.success(t('levelSaved')))
                  .catch(() => undefined);
              }}
            />
          </SettingsRow>
          <SettingsRow label={t('budgetLabel')} description={t('budgetHint')} htmlFor="day-budget">
            <span className="ds-inline-unit">
              <TextField
                id="day-budget"
                className="ds-extension-field"
                aria-label={t('budgetAria')}
                inputMode="decimal"
                value={budgetValue}
                placeholder="–"
                disabled={!editable || !autopilot.data || setBudgets.isPending}
                onChange={(event) => setBudgetDraft(event.target.value)}
                onBlur={() => void saveBudget()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              <span className="ds-unit">{t('perDay')}</span>
            </span>
          </SettingsRow>
          <SettingsRow label={t('localLabel')} description={t('localHint')}>
            <ButtonLink href={helenaSettingsPath('local-ai')} size="small">
              {t('instanceWide')}
            </ButtonLink>
          </SettingsRow>
          <SettingsRow label={t('jevLabel')} description={t('jevHint')}>
            <ButtonLink href={helenaSettingsPath('decisions')} size="small">
              {t('instanceWide')}
            </ButtonLink>
          </SettingsRow>
          <SettingsRow label={t('memoryLabel')} description={t('memoryHint')}>
            <ButtonLink href={team} size="small">
              {t('perAgent')}
            </ButtonLink>
          </SettingsRow>
        </SettingsGroup>
      </div>
    </SectionPageView>
  );
}
