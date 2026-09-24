'use client';

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import { agentsPath } from '@/utils/paths';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import { usePermissions } from '@/hooks/usePermissions';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import type { AutopilotLevel } from '@/lib/api/endpoints/autopilot';
import {
  useProjectAutopilot,
  useSetProjectBudgets,
  useSetProjectLevel,
} from '@/services/autopilot.service';
import AutopilotLevelPicker from '@/features/autopilot/components/AutopilotLevelPicker';
import AutopilotRuleSummary from '@/features/autopilot/components/AutopilotRuleSummary';
import BudgetFields from '@/features/autopilot/components/BudgetFields';
import AutopilotAgentList from '@/features/autopilot/components/AutopilotAgentList';
import PolicyDecisionLog from '@/features/autopilot/components/PolicyDecisionLog';
import {
  changedBudgets,
  draftFrom,
  type BudgetCellKey,
} from '@/features/autopilot/utils/autopilotFormat';
import SettingsToolbar from './components/SettingsToolbar';
import { SettingsResourceProvider } from './context/settingsPermission';

const section = settingsSection('autopilot');

// Projekt → Einstellungen → Autopilot (/project/:projectKey/settings/autopilot): how
// independently the project's agents act, in plain words, the project's budgets, the level
// each agent works at, and the policy engine's decisions. The level applies on click; the
// budgets are saved from the header.
export default function SettingsAutopilotPage() {
  const { project } = useShell();
  if (!project) return null;
  return <AutopilotPage projectKey={project.project.key} />;
}

function AutopilotPage({ projectKey }: { projectKey: string }) {
  const t = useTranslations('autopilot');
  const tCommon = useTranslations('common');
  const sectionText = useSettingsSectionText()(section.slug);
  const { can } = usePermissions();
  const editable = can(section.resource, 'edit');
  const query = useProjectAutopilot(projectKey);
  const setLevel = useSetProjectLevel(projectKey);
  const setBudgets = useSetProjectBudgets(projectKey);
  const data = query.data;

  const [draft, setDraft] = useState<Record<BudgetCellKey, string> | null>(null);
  const stored = useMemo(() => (data ? draftFrom(data.budgets) : null), [data]);
  // The first read fills the draft; later reads leave what was typed (adjusted during
  // render, not in an effect).
  if (draft === null && stored !== null) setDraft(stored);
  const changes = data && draft ? changedBudgets(data.budgets, draft) : [];
  const dirty = changes === null || changes.length > 0;

  async function chooseLevel(level: AutopilotLevel) {
    if (!data || level === data.level) return;
    try {
      await setLevel.mutateAsync(level);
      toast.success(t('levelSaved', { level }));
    } catch {
      // The failure already surfaced through the global mutation error toast.
    }
  }

  async function saveBudgets() {
    if (changes === null) {
      toast.error(t('invalidLimit'));
      return;
    }
    try {
      const next = await setBudgets.mutateAsync(changes);
      setDraft(draftFrom(next.budgets));
      toast.success(t('budgetsSaved'));
    } catch {
      // Surfaced by the global mutation error toast.
    }
  }

  const rules = data?.levels.find((entry) => entry.level === data.level)?.rules ?? [];

  return (
    <SectionPageView title={sectionText.label} description={sectionText.description} wide>
      <SettingsToolbar
        primary={
          editable
            ? {
                id: 'save',
                label: setBudgets.isPending ? tCommon('saving') : tCommon('save'),
                icon: Check,
                disabled: !dirty || setBudgets.isPending,
                onClick: () => void saveBudgets(),
              }
            : undefined
        }
      />
      <SettingsResourceProvider resource={section.resource}>
        <RequirePermission resource={section.resource} action="read">
          {!data || !draft ? (
            <ListSkeleton rows={6} rowClassName="h-10" />
          ) : (
            <div className="space-y-8">
              <SettingsSection title={t('levelTitle')}>
                <SettingsCard className="space-y-5 p-4">
                  <AutopilotLevelPicker
                    label={t('levelTitle')}
                    value={data.level}
                    onChange={(level) => void chooseLevel(level)}
                    disabled={!editable || setLevel.isPending}
                  />
                  <AutopilotRuleSummary rules={rules} />
                </SettingsCard>
              </SettingsSection>

              <SettingsSection title={t('budgetsTitle')} description={t('budgetsHint')}>
                <SettingsCard>
                  <BudgetFields
                    idPrefix="project-budget"
                    budgets={data.budgets}
                    draft={draft}
                    disabled={!editable || setBudgets.isPending}
                    onChange={(key, value) => setDraft({ ...draft, [key]: value })}
                  />
                </SettingsCard>
                <p className="mt-2 text-xs text-muted-foreground">{t('estimate')}</p>
              </SettingsSection>

              <SettingsSection title={t('agentsTitle')}>
                <SettingsCard>
                  <AutopilotAgentList
                    agents={data.agents}
                    agentHref={(id) => `${agentsPath()}?agent=${id}`}
                  />
                </SettingsCard>
              </SettingsSection>

              <SettingsSection title={t('logTitle')}>
                <PolicyDecisionLog projectKey={projectKey} />
              </SettingsSection>
            </div>
          )}
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
