'use client';

import { useId } from 'react';
import { Cpu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Switch } from '@/components/ui/switch';
import { SettingsGroup, SettingsRow } from '@/design-system';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AiChatModel, UnavailableChatModel } from '@/lib/api/endpoints/agentChat';
import type { AgentRuntimeConflict, AiAgent } from '@/lib/api/endpoints/agents';
import AgentModelIssue from '@/features/model-availability/components/AgentModelIssue';
import {
  refusalOf,
  refusedModels,
  templateFallbackModel,
} from '@/features/model-availability/utils/modelFailure';
import { useTeamModelAvailability } from '@/features/model-availability/services/modelAvailability.service';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { useAgentCan, useAgentSection } from '../../context/agentSection';
import type { AgentFormValue } from '../../utils/agentForm';
import { AgentFormSection } from './AgentFormSection';
import AgentRuntimeConflicts from './AgentRuntimeConflicts';
import { runtimeSelectionForModel } from './AgentRuntimePolicySection.logic';
import FallbackModelsEditor from '@/features/agent-runtime/components/FallbackModelsEditor';
import AgentCompressionSettings from './AgentCompressionSettings';

const AGENT_DEFAULT = '__agent_default__';

function lines(value: string) {
  return value.split(/\r?\n/);
}

export default function AgentRuntimePolicySection({
  open,
  onOpenChange,
  value,
  onChange,
  models,
  conflicts,
  unavailable = [],
  agent = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: AgentFormValue;
  onChange: (patch: Partial<AgentFormValue>) => void;
  models: AiChatModel[];
  conflicts: AgentRuntimeConflict[];
  // Models the provider refused this account, which the list leaves out, and the agent
  // (for a template copy that fell back to the default).
  unavailable?: UnavailableChatModel[];
  agent?: AiAgent | null;
}) {
  const t = useTranslations('teams.agents.runtimePolicy');
  const { teamId } = useAgentSection();
  const canEdit = useAgentCan()('edit');
  // The template library is already cached for the editor (AgentTemplateDriftSection).
  const template = useAiAgentsQuery(agent?.sourceTemplateId != null ? teamId : null).data?.find(
    (entry) => entry.id === agent?.sourceTemplateId,
  );
  // What the agent's catalog refuses, and what the team knows besides (a copy whose runner
  // has not published a catalog yet).
  const runtime = value.runtimePolicy.runtime ?? 'hermes';
  const findings = useTeamModelAvailability(teamId).data;
  const refused = refusedModels(unavailable, findings?.entries, runtime);
  // The Hermes login the saved model runs through, when the provider rejected it (the token
  // keeper's status); a model changed in the form is not the one it was worked out for.
  const deadLogin =
    agent && value.model === (agent.model ?? '')
      ? findings?.deadLogins?.find((login) => login.agents.some((entry) => entry.id === agent.id))
      : undefined;
  const tFallback = useTranslations('agentRuntime.fallback');
  const fallbackId = useId();
  const policy = value.runtimePolicy;
  const patchPolicy = (patch: Partial<typeof policy>) =>
    onChange({ runtimePolicy: { ...policy, ...patch } });
  const takeOverSoul = (content: string) =>
    patchPolicy({
      files: [
        ...policy.files.filter((file) => file.path !== 'SOUL.md'),
        { kind: 'instructions', path: 'SOUL.md', content },
      ],
    });

  const selectModel = (nextValue: string) => {
    const next = runtimeSelectionForModel(
      models,
      nextValue === AGENT_DEFAULT ? null : nextValue,
      policy.reasoningEffort,
    );
    onChange({
      model: next.model ?? '',
      runtimePolicy: { ...policy, reasoningEffort: next.reasoningEffort },
    });
  };

  return (
    <AgentFormSection
      open={open}
      onOpenChange={onOpenChange}
      icon={Cpu}
      title={t('title')}
      hint={t('hint')}
    >
      <AgentModelIssue
        teamId={teamId}
        refusal={refusalOf(value.model, refused)}
        runtime={runtime}
        templateModel={
          agent
            ? templateFallbackModel(
                { model: value.model || null, sourceTemplateId: agent.sourceTemplateId },
                template,
                refused,
              )
            : null
        }
        deadLogin={deadLogin}
        model={value.model || null}
        canEdit={canEdit}
        onUseDefault={() => selectModel(AGENT_DEFAULT)}
      />

      <AgentRuntimeConflicts conflicts={conflicts} onTakeOver={takeOverSoul} />
      <SettingsGroup
        title={t('behaviourTitle')}
        advanced={
          <div className="space-y-6">
            {(policy.runtime ?? 'hermes') === 'hermes' && (
              <AgentCompressionSettings
                policy={policy}
                models={models}
                canEdit={canEdit}
                onChange={(runtimePolicy) => onChange({ runtimePolicy })}
              />
            )}

            {/* Which tools the agent has is switched per tool in Abilities (toolDeny), for every
          runtime. An allow list next to it had no effect and is gone (hub/cli-runtimes). */}
            <div className="space-y-1.5">
              <label htmlFor="runtime-mcpGrants" className="text-sm font-medium">
                {t('mcpGrants')}
              </label>
              <Textarea
                id="runtime-mcpGrants"
                rows={2}
                placeholder={t('keysPlaceholder')}
                value={policy.mcpGrants.join('\n')}
                onChange={(event) => patchPolicy({ mcpGrants: lines(event.target.value) })}
              />
            </div>
          </div>
        }
      >
        <SettingsRow
          label={t('maxConcurrentChats')}
          description={t('maxConcurrentChatsHint')}
          htmlFor="agent-max-concurrent-chats"
        >
          <Input
            id="agent-max-concurrent-chats"
            className="w-20"
            type="number"
            min="1"
            max="20"
            step="1"
            value={value.maxConcurrentChats}
            onChange={(event) => onChange({ maxConcurrentChats: event.target.value })}
          />
        </SettingsRow>
        {(policy.runtime ?? 'hermes') === 'hermes' && (
          <SettingsRow
            label={tFallback('own')}
            description={
              policy.fallbackModels != null ? tFallback('ownHint') : tFallback('defaultHint')
            }
            htmlFor={fallbackId}
          >
            <Switch
              id={fallbackId}
              checked={policy.fallbackModels != null}
              onCheckedChange={(checked) => patchPolicy({ fallbackModels: checked ? [] : null })}
            />
          </SettingsRow>
        )}
        {(policy.runtime ?? 'hermes') === 'hermes' && policy.fallbackModels != null && (
          <div className="ds-settings-row is-stacked is-nested">
            <FallbackModelsEditor
              value={policy.fallbackModels}
              onChange={(fallbackModels) => patchPolicy({ fallbackModels })}
              suggestions={models.flatMap((model) =>
                model.provider ? [{ provider: model.provider, model: model.id }] : [],
              )}
            />
          </div>
        )}
      </SettingsGroup>
    </AgentFormSection>
  );
}
