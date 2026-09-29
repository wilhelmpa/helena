import { type ReactNode, useState } from 'react';
import { Sparkles, Wrench } from 'lucide-react';
import type { TeamProjectOption } from '@/lib/api/endpoints/teams';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { AiChatModel, UnavailableChatModel } from '@/lib/api/endpoints/agentChat';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { SettingsGroup, SettingsRow } from '@/design-system';
import { type AgentFormValue } from '../../utils/agentForm';
import { AgentFormSection } from './AgentFormSection';
import AgentAccessSection from './AgentAccessSection';
import AgentEnvironmentSection from './AgentEnvironmentSection';
import AgentProjectsSection from './AgentProjectsSection';
import AgentTokenSection from './AgentTokenSection';
import AgentTriggersSection from './AgentTriggersSection';
import { AgentInstructionsField } from './AgentInstructionsField';
import AgentRunnerSection from './AgentRunnerSection';
import AgentRuntimePolicySection from './AgentRuntimePolicySection';
import AgentAbilitiesSection from './AgentAbilitiesSection';
import AgentAutopilotSection from './AgentAutopilotSection';
import AgentTemplateDriftSection from './AgentTemplateDriftSection';
import AgentTemplateField from './AgentTemplateField';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import RuntimePicker from '@/components/helena/RuntimePicker';
import AgentHeartbeatSection from './AgentHeartbeatSection';
import AgentEscalationPin from '@/features/local-ai/components/AgentEscalationPin';
import { AgentFormPageModeCtx, useAgentDialog, type AgentFormPageId } from './agentFormPages';

// Which sections open when an existing agent is opened for editing, so the form reads
// as a short list of sections instead of a wall of fields. Basics is not in it because
// it never collapses; the API key section is, because an external agent is unusable
// until its key is in the operator's hands. A new agent starts with all of them closed:
// nothing is filled in yet, and the key section opens itself once a key is issued.
const DEFAULT_OPEN: Record<string, boolean> = { access: true, projects: true, token: true };

// Content width of the full-width editor. The sheet sizes its footer to match, so the
// two must stay in sync.
export const AGENT_EXPANDED_WIDTH = 'max-w-[860px]';

// The agent form: its sections in a stacked column or, at full width, in one readable
// column. Controlled by value + onChange(patch).
export default function TeamAiAgentFields({
  value,
  onChange,
  projects,
  expanded = false,
  chatModels,
  localModels = [],
  chatModelsUnavailable = [],
  agent,
  skillsContent,
  skillsBadge,
  toolsContent,
  toolsBadge,
  mcpServersContent,
  onSkillPromoted,
  revealedKey,
  onRevealedKey,
  initialOpenSection,
}: {
  value: AgentFormValue;
  onChange: (patch: Partial<AgentFormValue>) => void;
  // The projects of the team, which the Projects section attaches the agent to and the
  // Triggers section reads the member fields of.
  projects: TeamProjectOption[];
  expanded?: boolean;
  chatModels: AiChatModel[];
  localModels?: AiChatModel[];
  // Models the provider refused this account, left out of chatModels.
  chatModelsUnavailable?: UnavailableChatModel[];
  // The saved agent, for the state only the server knows (its runner's presence).
  // Null while creating.
  agent: AiAgent | null;
  // The Skills section body, built by the parent (it owns the skill library and
  // links). Null when Skills does not apply; the section is hidden then.
  skillsContent?: ReactNode | null;
  // "enabled / available" for the Skills header and nav entry. Undefined when the
  // library is empty and there is nothing to count.
  skillsBadge?: string;
  // The Tools section body (configured custom tools), built the same way.
  toolsContent?: ReactNode | null;
  // "enabled / available" for the Tools header and nav entry.
  toolsBadge?: string;
  // The MCP servers of the team's library, in the Abilities section.
  mcpServersContent?: ReactNode;
  // A learned skill the Abilities section took into the library, enabled on the agent.
  onSkillPromoted: (skillId: number) => void;
  // The plaintext key issued in this sheet, shown once in the API key section, and the way to drop it or replace it after a regenerate.
  revealedKey: string | null;
  onRevealedKey: (apiKey: string | null) => void;
  // A section id to open in addition to the defaults, e.g. a `/skills` or `/memory`
  // chat command that sent the member straight here to look at this agent.
  initialOpenSection?: string;
}) {
  const t = useTranslations('teams.agents');
  // The escalation rules are the Administrator's (GET /god/escalation).
  const isGod = useSession().data?.user.role === 'god';
  const tCommon = useTranslations('common');
  const tRuntime = useTranslations('chatWorkspace.runtimePicker');
  const dialog = useAgentDialog();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => ({
    ...(agent ? DEFAULT_OPEN : {}),
    ...(initialOpenSection ? { [initialOpenSection]: true } : {}),
  }));
  const sectionProps = (id: string) => ({
    open: openSections[id] ?? false,
    onOpenChange: (o: boolean) => setOpenSections((s) => ({ ...s, [id]: o })),
  });

  // No section header: the name, handle, and instructions are the agent itself, so
  // they open the form as plain fields rather than as one more thing to expand.
  const basicsSection = (
    <div key="basics" className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="agent-name" className="text-sm font-medium">
          {tCommon('name')}
        </label>
        <Input
          id="agent-name"
          autoFocus
          placeholder={t('namePlaceholder')}
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="agent-username" className="text-sm font-medium">
          {t('username')}
        </label>
        <Input
          id="agent-username"
          placeholder={t('usernamePlaceholder')}
          value={value.username}
          onChange={(e) => onChange({ username: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('usernameHint')}</p>
      </div>

      <AgentInstructionsField
        value={value.instructions}
        onChange={(instructions) => onChange({ instructions })}
      />

      {value.projectId == null && (
        <AgentTemplateField
          checked={value.template}
          onChange={(template) =>
            onChange({ template, projectScope: template ? 'selected' : value.projectScope })
          }
        />
      )}
      {agent && <AgentTemplateDriftSection agent={agent} />}
    </div>
  );

  const accessSection = (
    <AgentAccessSection
      key="access"
      {...sectionProps('access')}
      value={value}
      onChange={onChange}
    />
  );

  // An agent that exists shows the variables its runs receive; a template runs nowhere.
  const environmentSection =
    agent && !agent.template ? (
      <AgentEnvironmentSection key="environment" {...sectionProps('environment')} agent={agent} />
    ) : null;

  // A template works in no project, and an agent created in a project works in that one.
  const projectsSection =
    value.template || value.projectId != null ? null : (
      <AgentProjectsSection
        key="projects"
        {...sectionProps('projects')}
        value={value}
        onChange={onChange}
        projects={projects}
      />
    );

  const tokenSection = (
    <AgentTokenSection
      key="token"
      {...sectionProps('token')}
      agent={agent}
      revealedKey={revealedKey}
      onRevealedKey={onRevealedKey}
    />
  );

  const runnerSection = (
    <AgentRunnerSection key="runner" {...sectionProps('runner')} agent={agent} />
  );

  // An agent that exists has an Autopilot: its level and budgets are saved on their own.
  const autopilotSection = agent ? (
    <AgentAutopilotSection key="autopilot" {...sectionProps('autopilot')} agent={agent} />
  ) : null;

  const runtimePolicySection = (
    <AgentRuntimePolicySection
      key="runtime-policy"
      {...sectionProps('runtime-policy')}
      value={value}
      onChange={onChange}
      models={chatModels}
      conflicts={agent?.runtimeState.conflicts ?? []}
      unavailable={chatModelsUnavailable}
      agent={agent}
    />
  );

  const abilitiesSection = (
    <AgentAbilitiesSection
      key="abilities"
      {...sectionProps('abilities')}
      agent={agent}
      value={value}
      onChange={onChange}
      mcpServersContent={mcpServersContent}
      onSkillPromoted={onSkillPromoted}
    />
  );

  const triggersSection = (
    <AgentTriggersSection
      key="triggers"
      {...sectionProps('triggers')}
      value={value}
      onChange={onChange}
      projects={projects}
    />
  );

  const heartbeatSection = (
    <AgentHeartbeatSection
      key="heartbeat"
      {...sectionProps('heartbeat')}
      value={value}
      onChange={onChange}
      agent={agent}
    />
  );

  const skillsSection =
    skillsContent != null ? (
      <AgentFormSection
        key="skills"
        {...sectionProps('skills')}
        icon={Sparkles}
        title={t('skills')}
        hint={t('skillsHint')}
        headerRight={skillsBadge}
      >
        {skillsContent}
      </AgentFormSection>
    ) : null;

  const toolsSection =
    toolsContent != null ? (
      <AgentFormSection
        key="tools"
        {...sectionProps('tools')}
        icon={Wrench}
        title={t('tools')}
        hint={t('toolsHint')}
        headerRight={toolsBadge}
      >
        {toolsContent}
      </AgentFormSection>
    ) : null;

  const runtimeControls = (
    <>
      <RuntimePicker
        runtime={value.runtimePolicy.runtime ?? 'hermes'}
        model={value.model || null}
        reasoning={value.runtimePolicy.reasoningEffort}
        external
        models={[
          ...((value.runtimePolicy.runtime ?? 'hermes') ===
          (agent?.runtimePolicy.runtime ?? 'hermes')
            ? chatModels
            : []),
          ...localModels,
        ]}
        unavailable={
          (value.runtimePolicy.runtime ?? 'hermes') === (agent?.runtimePolicy.runtime ?? 'hermes')
            ? chatModelsUnavailable
            : []
        }
        onChange={(runtime, model, reasoning) =>
          onChange({
            model: model ?? '',
            runtimePolicy: {
              ...value.runtimePolicy,
              runtime: runtime === 'hermes' ? undefined : runtime,
              reasoningEffort: reasoning,
            },
          })
        }
      />
      {value.runtimePolicy.runtime === 'command' && (
        <label className="mt-3 block space-y-1.5">
          <span className="text-sm font-medium">{tRuntime('commandScript')}</span>
          <Input
            dir="ltr"
            value={value.runtimePolicy.commandScript ?? ''}
            placeholder="scripts/review.sh"
            onChange={(event) =>
              onChange({
                runtimePolicy: {
                  ...value.runtimePolicy,
                  commandScript: event.target.value || undefined,
                },
              })
            }
          />
          <span className="block text-xs text-muted-foreground">
            {tRuntime('commandScriptHint')}
          </span>
        </label>
      )}
      {value.runtimePolicy.runtime === 'webhook' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{tRuntime('webhookUrl')}</span>
            <Input
              dir="ltr"
              type="url"
              value={value.runtimePolicy.webhookUrl ?? ''}
              placeholder="https://"
              onChange={(event) =>
                onChange({
                  runtimePolicy: {
                    ...value.runtimePolicy,
                    webhookUrl: event.target.value || undefined,
                  },
                })
              }
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{tRuntime('webhookSecretEnv')}</span>
            <Input
              dir="ltr"
              value={value.runtimePolicy.webhookSecretEnv ?? ''}
              placeholder="WEBHOOK_SECRET"
              onChange={(event) =>
                onChange({
                  runtimePolicy: {
                    ...value.runtimePolicy,
                    webhookSecretEnv: event.target.value || undefined,
                  },
                })
              }
            />
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">{tRuntime('webhookHint')}</p>
        </div>
      )}
    </>
  );

  const stack = [
    <div key="runtime-picker" className="rounded-md border border-border/60 p-4">
      <p className="mb-3 text-xs text-muted-foreground">{tRuntime('summary')}</p>
      {runtimeControls}
    </div>,
    basicsSection,
    projectsSection,
    autopilotSection,
    runtimePolicySection,
    abilitiesSection,
    skillsSection,
    toolsSection,
    tokenSection,
    accessSection,
    environmentSection,
    triggersSection,
    heartbeatSection,
    runnerSection,
  ];

  // In the agent dialog: only the page the dialog's left column picked, its sections open.
  if (dialog) {
    const pages: Record<AgentFormPageId, ReactNode> = {
      general: (
        <section className="ds-agent-page">
          <header className="ds-agent-page-head">
            <div>
              <h2>{t('pages.general')}</h2>
              <p>{t('pages.generalHint')}</p>
            </div>
          </header>
          <div className="ds-agent-page-body">
            <SettingsGroup>
              <SettingsRow label={tCommon('name')} htmlFor="agent-name">
                <Input
                  id="agent-name"
                  className="w-64"
                  placeholder={t('namePlaceholder')}
                  value={value.name}
                  onChange={(e) => onChange({ name: e.target.value })}
                />
              </SettingsRow>
              <SettingsRow
                label={t('username')}
                description={t('usernameHint')}
                htmlFor="agent-username"
              >
                <Input
                  id="agent-username"
                  className="w-64"
                  dir="ltr"
                  placeholder={t('usernamePlaceholder')}
                  value={value.username}
                  onChange={(e) => onChange({ username: e.target.value })}
                />
              </SettingsRow>
              {value.projectId == null && (
                <SettingsRow label={t('template')} description={t('templateHint')}>
                  <Switch
                    checked={value.template}
                    aria-label={t('template')}
                    onCheckedChange={(template) =>
                      onChange({
                        template,
                        projectScope: template ? 'selected' : value.projectScope,
                      })
                    }
                  />
                </SettingsRow>
              )}
            </SettingsGroup>
            <SettingsGroup title={t('pages.execution')}>
              <div className="ds-settings-row is-stacked">{runtimeControls}</div>
            </SettingsGroup>
            <SettingsGroup>
              <div className="ds-settings-row is-stacked">
                <AgentInstructionsField
                  value={value.instructions}
                  onChange={(instructions) => onChange({ instructions })}
                />
              </div>
            </SettingsGroup>
            {agent && <AgentTemplateDriftSection agent={agent} />}
          </div>
        </section>
      ),
      projects: projectsSection,
      autopilot: autopilotSection,
      'runtime-policy': (
        <>
          {runtimePolicySection}
          {/* "Festlegung für diesen Agenten" (owner 28.09.): the rules are central in
              Administrator › Agenten und Modelle. */}
          {agent && !agent.template && isGod && <AgentEscalationPin agentId={agent.id} />}
        </>
      ),
      triggers: triggersSection,
      heartbeat: heartbeatSection,
      abilities: abilitiesSection,
      skills: skillsSection,
      tools: toolsSection,
      access: accessSection,
      environment: environmentSection,
      token: tokenSection,
      runner: runnerSection,
    };
    return (
      <div className="ds-agent-pages">
        <AgentFormPageModeCtx.Provider value={true}>
          {pages[dialog.page] ?? pages.general}
        </AgentFormPageModeCtx.Provider>
      </div>
    );
  }

  // Full width: one readable column of sections, scrolling inside this component so
  // the sheet's header and footer stay put.
  if (expanded) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-10 sm:pt-2">
        <div className={`mx-auto w-full space-y-8 ${AGENT_EXPANDED_WIDTH}`}>{stack}</div>
      </div>
    );
  }

  // Compact side panel: the same sections stacked in one column.
  return <div className="space-y-6">{stack}</div>;
}
