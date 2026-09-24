'use client';

import { Cpu, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { AiChatModel } from '@/lib/api/endpoints/agentChat';
import {
  AGENT_RUNTIME_KINDS,
  type AgentRuntimeConflict,
  type AgentRuntimeKind,
} from '@/lib/api/endpoints/agents';
import type { AgentFormValue } from '../../utils/agentForm';
import { AgentFormSection } from './AgentFormSection';
import AgentRuntimeConflicts from './AgentRuntimeConflicts';
import { runtimeSelectionForModel } from './AgentRuntimePolicySection.logic';
import FallbackModelsEditor from '@/features/agent-runtime/components/FallbackModelsEditor';

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
  modelsLoading,
  modelsError,
  conflicts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: AgentFormValue;
  onChange: (patch: Partial<AgentFormValue>) => void;
  models: AiChatModel[];
  modelsLoading: boolean;
  modelsError: boolean;
  conflicts: AgentRuntimeConflict[];
}) {
  const t = useTranslations('teams.agents.runtimePolicy');
  const tFallback = useTranslations('agentRuntime.fallback');
  const policy = value.runtimePolicy;
  const selectedModel = models.find((entry) => entry.id === value.model);
  const unavailableModel = value.model.length > 0 && !selectedModel;
  const unavailableReasoning =
    policy.reasoningEffort != null &&
    (!selectedModel || !selectedModel.thinkingLevels.includes(policy.reasoningEffort));
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
      <div className="space-y-1.5">
        <label htmlFor="agent-runtime-kind" className="text-sm font-medium">
          {t('runtime')}
        </label>
        <Select
          value={policy.runtime ?? 'hermes'}
          onValueChange={(runtime) =>
            patchPolicy({
              runtime: runtime === 'hermes' ? undefined : (runtime as AgentRuntimeKind),
            })
          }
        >
          <SelectTrigger id="agent-runtime-kind" className="w-full sm:w-1/2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGENT_RUNTIME_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`runtimeKind.${kind}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {(policy.runtime ?? 'hermes') === 'hermes'
            ? t('runtimeHermesHint')
            : t('runtimeCliHint', { kind: policy.runtime ?? '' })}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="agent-runtime-model" className="text-sm font-medium">
            {t('model')}
          </label>
          <Select
            value={value.model || AGENT_DEFAULT}
            onValueChange={selectModel}
            disabled={modelsLoading}
          >
            <SelectTrigger id="agent-runtime-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AGENT_DEFAULT}>{t('agentDefault')}</SelectItem>
              {unavailableModel && (
                <SelectItem value={value.model} disabled>
                  {t('unavailable', { value: value.model })}
                </SelectItem>
              )}
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name} · {model.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {modelsLoading
              ? t('modelsLoading')
              : modelsError
                ? t('modelsError')
                : models.length === 0
                  ? t('modelsEmpty')
                  : t('modelsHint')}
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="agent-runtime-reasoning" className="text-sm font-medium">
            {t('reasoning')}
          </label>
          <Select
            value={policy.reasoningEffort ?? AGENT_DEFAULT}
            onValueChange={(effort) =>
              patchPolicy({ reasoningEffort: effort === AGENT_DEFAULT ? null : effort })
            }
            disabled={modelsLoading || !selectedModel}
          >
            <SelectTrigger id="agent-runtime-reasoning" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AGENT_DEFAULT}>
                {t('agentDefault')}
                {selectedModel?.thinkingDefault ? ` · ${selectedModel.thinkingDefault}` : ''}
              </SelectItem>
              {unavailableReasoning && policy.reasoningEffort && (
                <SelectItem value={policy.reasoningEffort} disabled>
                  {t('unavailable', { value: policy.reasoningEffort })}
                </SelectItem>
              )}
              {selectedModel?.thinkingLevels.map((effort) => (
                <SelectItem key={effort} value={effort}>
                  {effort}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {(policy.runtime ?? 'hermes') === 'hermes' && (
        <div className="space-y-2">
          <label className="flex items-start gap-2">
            <Checkbox
              className="mt-0.5"
              checked={policy.fallbackModels != null}
              onCheckedChange={(checked) =>
                patchPolicy({ fallbackModels: checked === true ? [] : null })
              }
            />
            <span className="min-w-0">
              <span className="text-sm font-medium">{tFallback('own')}</span>
              <span className="block text-xs text-muted-foreground">
                {policy.fallbackModels != null ? tFallback('ownHint') : tFallback('defaultHint')}
              </span>
            </span>
          </label>
          {policy.fallbackModels != null && (
            <FallbackModelsEditor
              value={policy.fallbackModels}
              onChange={(fallbackModels) => patchPolicy({ fallbackModels })}
              suggestions={models.flatMap((model) =>
                model.provider ? [{ provider: model.provider, model: model.id }] : [],
              )}
            />
          )}
        </div>
      )}

      <label className="flex items-start gap-2">
        <Checkbox
          className="mt-0.5"
          checked={value.memoryEnabled}
          onCheckedChange={(checked) => onChange({ memoryEnabled: checked === true })}
        />
        <span className="text-sm font-medium">{t('memory')}</span>
      </label>
      {value.memoryEnabled && (
        <Input
          type="number"
          min="1"
          aria-label={t('memoryWindowLabel')}
          placeholder={t('memoryWindowPlaceholder')}
          value={value.memoryLastMessages}
          onChange={(event) => onChange({ memoryLastMessages: event.target.value })}
        />
      )}

      <div className="space-y-1.5">
        <label htmlFor="agent-max-concurrent-chats" className="text-sm font-medium">
          {t('maxConcurrentChats')}
        </label>
        <Input
          id="agent-max-concurrent-chats"
          type="number"
          min="1"
          max="20"
          step="1"
          value={value.maxConcurrentChats}
          onChange={(event) => onChange({ maxConcurrentChats: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('maxConcurrentChatsHint')}</p>
      </div>

      {(
        [
          ['toolAllow', t('toolAllow')],
          ['mcpGrants', t('mcpGrants')],
        ] as const
      ).map(([key, label]) => (
        <div key={key} className="space-y-1.5">
          <label htmlFor={`runtime-${key}`} className="text-sm font-medium">
            {label}
          </label>
          <Textarea
            id={`runtime-${key}`}
            rows={2}
            placeholder={t('keysPlaceholder')}
            value={policy[key].join('\n')}
            onChange={(event) => patchPolicy({ [key]: lines(event.target.value) })}
          />
        </div>
      ))}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t('managedFiles')}</p>
            <p className="text-xs text-muted-foreground">{t('managedFilesHint')}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              patchPolicy({
                files: [...policy.files, { kind: 'instructions', path: '', content: '' }],
              })
            }
          >
            <Plus className="me-1 size-3.5" /> {t('addFile')}
          </Button>
        </div>
        <AgentRuntimeConflicts conflicts={conflicts} onTakeOver={takeOverSoul} />
        {policy.files.map((file, index) => (
          <div key={`${index}-${file.path}`} className="space-y-2 rounded-md border p-3">
            <div className="flex gap-2">
              <Input
                aria-label={t('filePathLabel', { index: index + 1 })}
                placeholder={t('filePathPlaceholder')}
                value={file.path}
                onChange={(event) => {
                  const files = [...policy.files];
                  files[index] = { ...file, path: event.target.value };
                  patchPolicy({ files });
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t('removeFile', { index: index + 1 })}
                onClick={() => patchPolicy({ files: policy.files.filter((_, i) => i !== index) })}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <Textarea
              rows={6}
              aria-label={t('fileContentLabel', { index: index + 1 })}
              value={file.content}
              onChange={(event) => {
                const files = [...policy.files];
                files[index] = { ...file, content: event.target.value };
                patchPolicy({ files });
              }}
            />
          </div>
        ))}
      </div>
    </AgentFormSection>
  );
}
