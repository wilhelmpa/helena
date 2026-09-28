'use client';

import type { AiChatModel, UnavailableChatModel } from '@/lib/api/endpoints/agentChat';
import type { AgentRuntimeKind } from '@/lib/api/endpoints/agents';
import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type RuntimeChoice = AgentRuntimeKind | 'local';

export function runtimeChoice(runtime: AgentRuntimeKind, model: string | null): RuntimeChoice {
  return runtime === 'hermes' && model?.startsWith('helena-local/') ? 'local' : runtime;
}

export default function RuntimePicker({
  runtime,
  model,
  reasoning,
  models,
  unavailable = [],
  disabled = false,
  onChange,
}: {
  runtime: AgentRuntimeKind;
  model: string | null;
  reasoning: string | null;
  models: AiChatModel[];
  unavailable?: UnavailableChatModel[];
  disabled?: boolean;
  onChange: (runtime: AgentRuntimeKind, model: string | null, reasoning: string | null) => void;
}) {
  const t = useTranslations('chatWorkspace.runtimePicker');
  const choice = runtimeChoice(runtime, model);
  const availableModels = [...new Map(models.map((entry) => [entry.id, entry])).values()];
  const localModels = availableModels.filter((entry) => entry.id.startsWith('helena-local/'));
  const runtimeModels = availableModels.filter((entry) =>
    choice === 'local'
      ? entry.id.startsWith('helena-local/')
      : !entry.local && !entry.id.startsWith('helena-'),
  );
  const selected = runtimeModels.find((entry) => entry.id === model);
  const selectRuntime = (next: RuntimeChoice) => {
    if (next === 'local') {
      onChange('hermes', localModels[0]?.id ?? null, null);
    } else {
      onChange(next, null, null);
    }
  };

  return (
    <div className="grid gap-3 sm:grid-cols-3" aria-label={t('summary')}>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t('runtime')}</span>
        <Select
          value={choice}
          onValueChange={(value) => selectRuntime(value as RuntimeChoice)}
          disabled={disabled}
        >
          <SelectTrigger aria-label={t('runtime')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['claude', 'codex', 'local', 'hermes'] as const).map((option) => {
              const reason =
                option === 'local' && localModels.length === 0 ? t('localMissing') : null;
              return (
                <SelectItem
                  key={option}
                  value={option}
                  disabled={!!reason}
                  title={reason ?? undefined}
                >
                  {t(option)}
                  {reason ? ` · ${reason}` : ''}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t('model')}</span>
        <Select
          value={model ?? '__default__'}
          onValueChange={(value) => onChange(runtime, value === '__default__' ? null : value, null)}
          disabled={disabled}
        >
          <SelectTrigger aria-label={t('model')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">{t('summary')}</SelectItem>
            {model && !selected && (
              <SelectItem value={model} disabled>
                {model} ·{' '}
                {unavailable.find((entry) => entry.id === model)?.detail ?? t('unavailable')}
              </SelectItem>
            )}
            {unavailable
              .filter((entry) => entry.id !== model)
              .map((entry) => (
                <SelectItem
                  key={entry.id}
                  value={entry.id}
                  disabled
                  title={entry.detail ?? undefined}
                >
                  {entry.id} · {entry.detail ?? t('unavailable')}
                </SelectItem>
              ))}
            {runtimeModels.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t('reasoning')}</span>
        <Select
          value={reasoning ?? '__default__'}
          onValueChange={(value) =>
            onChange(runtime, model, value === '__default__' ? null : value)
          }
          disabled={disabled || !selected}
        >
          <SelectTrigger aria-label={t('reasoning')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">{t('summary')}</SelectItem>
            {selected?.thinkingLevels.map((level) => (
              <SelectItem key={level} value={level}>
                {level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
