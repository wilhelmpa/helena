'use client';

import { useMemo, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import { agentsPath, organizationPath } from '@/utils/paths';
import { useSession } from '@/lib/auth-client';
import { useInstanceProjectDefaultsQuery } from '@/features/god/services/god.service';
import {
  Badge,
  Button,
  ButtonLink,
  Inline,
  Section,
  SettingsGroup,
  SettingsRow,
  Stack,
  Text,
} from '@/design-system';
import { helenaSettingsPath } from './settingsModalCatalog';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import { usePermissions } from '@/hooks/usePermissions';
import SectionPageView from '@/components/common/page/SectionPageView';
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
  const tExecution = useTranslations('settings.execution');
  const tCommon = useTranslations('common');
  const { data: session } = useSession();
  // Helena's default for projects (Vorgaben für Projekte): a project level that differs is
  // an override, marked, with the way back (docs/einstellungen-struktur.md, Regeln).
  const defaults = useInstanceProjectDefaultsQuery(session?.user.role === 'god');
  const defaultLevel = defaults.data?.autopilotLevel ?? null;
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

  const levelOverridden = defaultLevel != null && data != null && data.level !== defaultLevel;
  const team = organizationPath(projectKey);

  return (
    <SectionPageView title={sectionText.label} wide>
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
            <Stack gap={6}>
              <SettingsGroup title={t('levelTitle')}>
                <SettingsRow
                  label={t('levelTitle')}
                  description={
                    levelOverridden
                      ? tExecution('levelOverridden', { level: defaultLevel })
                      : tExecution('levelDefault')
                  }
                  stacked
                >
                  <Stack gap={3}>
                    <Inline gap={3} wrap>
                      <AutopilotLevelPicker
                        label={t('levelTitle')}
                        value={data.level}
                        onChange={(level) => void chooseLevel(level)}
                        disabled={!editable || setLevel.isPending}
                      />
                      {levelOverridden && (
                        <>
                          <Badge tone="accent">{tExecution('overridden')}</Badge>
                          <Button
                            size="small"
                            variant="ghost"
                            icon={<RotateCcw size={14} />}
                            disabled={!editable || setLevel.isPending}
                            onClick={() => void chooseLevel(defaultLevel as AutopilotLevel)}
                          >
                            {tExecution('resetToDefault')}
                          </Button>
                        </>
                      )}
                    </Inline>
                    <AutopilotRuleSummary rules={rules} />
                  </Stack>
                </SettingsRow>
              </SettingsGroup>

              <SettingsGroup title={t('budgetsTitle')} description={t('budgetsHint')}>
                <BudgetFields
                  idPrefix="project-budget"
                  budgets={data.budgets}
                  draft={draft}
                  disabled={!editable || setBudgets.isPending}
                  onChange={(key, value) => setDraft({ ...draft, [key]: value })}
                  onBlur={() => {
                    if (dirty) void saveBudgets();
                  }}
                />
                <Text size="xs" tone="muted">
                  {t('estimate')}
                </Text>
              </SettingsGroup>

              {/* Standard-Ausführung was a page of its own (owner, O58): it lives here now.
                  Its values belong to the agents or to Helena, so each row leads there. */}
              <SettingsGroup title={tExecution('title')} description={tExecution('note')}>
                <SettingsRow
                  label={tExecution('defaultLabel')}
                  description={tExecution('defaultHint')}
                >
                  <ButtonLink href={team} size="small">
                    {tExecution('manageAgents')}
                  </ButtonLink>
                </SettingsRow>
                <SettingsRow label={tExecution('localLabel')} description={tExecution('localHint')}>
                  <ButtonLink href={helenaSettingsPath('local-ai')} size="small">
                    {tExecution('instanceWide')}
                  </ButtonLink>
                </SettingsRow>
                <SettingsRow label={tExecution('jevLabel')} description={tExecution('jevHint')}>
                  <ButtonLink href={helenaSettingsPath('decisions')} size="small">
                    {tExecution('instanceWide')}
                  </ButtonLink>
                </SettingsRow>
                <SettingsRow
                  label={tExecution('memoryLabel')}
                  description={tExecution('memoryHint')}
                >
                  <ButtonLink href={team} size="small">
                    {tExecution('perAgent')}
                  </ButtonLink>
                </SettingsRow>
              </SettingsGroup>

              <Section title={t('agentsTitle')}>
                <AutopilotAgentList
                  agents={data.agents}
                  agentHref={(id) => `${agentsPath()}?agent=${id}`}
                />
              </Section>

              <Section title={t('logTitle')}>
                <PolicyDecisionLog projectKey={projectKey} />
              </Section>
            </Stack>
          )}
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
