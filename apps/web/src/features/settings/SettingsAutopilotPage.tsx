'use client';

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { settingsSection } from '@/utils/settingsSections';
import { teamListPath, teamOrganizationPath, organizationPath } from '@/utils/paths';
import { useSession } from '@/lib/auth-client';
import { useInstanceProjectDefaultsQuery } from '@/features/god/services/god.service';
import {
  Button,
  InheritedMark,
  ButtonLink,
  Inline,
  Section,
  SettingsGroup,
  SettingsRow,
  Stack,
  Text,
  TextArea,
} from '@/design-system';
import { useTeam } from '@/services/teams.service';
import {
  useOrganizationQuery,
  useSetProjectAssignment,
} from '@/features/organization/services/organization.service';
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
import {
  budgetsFromDefaults,
  budgetsMatchDefaults,
} from '@/features/autopilot/utils/budgetDefaults';
import StandingOrdersGroup from '@/features/autopilot/components/StandingOrdersGroup';
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
  const { can, isAdmin } = usePermissions();
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
  // The budgets are Helena's default for projects unless changed here (owner 28.09.:
  // an override is marked and has its way back).
  const defaultBudgets = defaults.data?.budgets ?? null;
  const budgetsOverridden =
    defaultBudgets != null && data != null && !budgetsMatchDefaults(data.budgets, defaultBudgets);

  async function resetBudgets() {
    if (!defaultBudgets) return;
    try {
      const next = await setBudgets.mutateAsync(budgetsFromDefaults(defaultBudgets));
      setDraft(draftFrom(next.budgets));
      toast.success(tExecution('budgetsReset'));
    } catch {
      // Surfaced by the global mutation error toast.
    }
  }
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
              <SettingsGroup title={tExecution('autopilotTitle')}>
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
                      {defaultLevel != null && (
                        <InheritedMark
                          overridden={levelOverridden}
                          disabled={!editable || setLevel.isPending}
                          onReset={
                            editable
                              ? () => void chooseLevel(defaultLevel as AutopilotLevel)
                              : undefined
                          }
                        />
                      )}
                    </Inline>
                    <AutopilotRuleSummary rules={rules} />
                  </Stack>
                </SettingsRow>
              </SettingsGroup>

              <SettingsGroup title={t('budgetsTitle')} description={t('budgetsHint')}>
                {defaultBudgets != null && (
                  <SettingsRow
                    label={tExecution(budgetsOverridden ? 'budgetsOverridden' : 'budgetsDefault')}
                    description={tExecution('budgetsDefaultHint')}
                  >
                    <InheritedMark
                      overridden={budgetsOverridden}
                      disabled={!editable || setBudgets.isPending}
                      onReset={editable ? () => void resetBudgets() : undefined}
                    />
                  </SettingsRow>
                )}
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

              {/* Instructions for every agent of the project (owner, 28.09.): the project's
                  standing text, and the standing orders (OpenClaw) — rules the agents follow
                  in every run, which they may also propose. */}
              <StandingOrdersGroup
                scope={{ projectKey }}
                title={tExecution('instructionsTitle')}
                description={tExecution('instructionsHint')}
                canEdit={isAdmin}
              >
                <ProjectInstructions projectKey={projectKey} />
              </StandingOrdersGroup>

              <Section title={t('agentsTitle')}>
                <AutopilotAgentList
                  agents={data.agents}
                  agentHref={(id) => teamListPath(teamOrganizationPath(), `agent=${id}`)}
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

function ProjectInstructions({ projectKey }: { projectKey: string }) {
  const tExecution = useTranslations('settings.execution');
  const tCommon = useTranslations('common');
  const { project } = useShell();
  const teamId = project?.project.teamId ?? null;
  const team = useTeam(teamId ?? 0);
  const canManage = team != null && team.role !== 'member';
  const organization = useOrganizationQuery(teamId);
  const entry = organization.data?.projects.find((item) => item.key === projectKey);
  const save = useSetProjectAssignment(teamId ?? 0);
  const [draft, setDraft] = useState<string | null>(null);
  if (!entry) return null;
  const value = draft ?? entry.instructions;
  return (
    <SettingsRow label={tExecution('instructionsLabel')} htmlFor="project-instructions" stacked>
      <Stack gap={2}>
        <TextArea
          id="project-instructions"
          rows={4}
          maxLength={4000}
          value={value}
          disabled={!canManage || save.isPending}
          placeholder={tExecution('instructionsPlaceholder')}
          onChange={(event) => setDraft(event.target.value)}
        />
        {canManage && (
          <Inline justify="end">
            <Button
              size="small"
              variant="quiet"
              disabled={draft === null || draft === entry.instructions || save.isPending}
              onClick={() =>
                save.mutate(
                  {
                    id: entry.id,
                    input: { departmentId: entry.departmentId, instructions: value },
                  },
                  {
                    onSuccess: () => {
                      setDraft(null);
                      toast.success(tExecution('instructionsSaved'));
                    },
                  },
                )
              }
            >
              {save.isPending ? tCommon('saving') : tCommon('save')}
            </Button>
          </Inline>
        )}
      </Stack>
    </SettingsRow>
  );
}
