'use client';

import { isLocalModel } from '@/features/local-ai/utils/modelIdentity';
import {
  groupLocalModels,
  localModelName,
  npuModelName,
} from '@/features/local-ai/utils/localProfile';
import { LOCAL_DEFAULT } from '@/lib/api/endpoints/localProfiles';

import type { AiChatModel, UnavailableChatModel } from '@/lib/api/endpoints/agentChat';
import type { AgentRuntimeKind } from '@/lib/api/endpoints/agents';
import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type RuntimeChoice = AgentRuntimeKind | 'local';

export function runtimeChoice(runtime: AgentRuntimeKind, model: string | null): RuntimeChoice {
  return runtime === 'hermes' && isLocalModel(model) ? 'local' : runtime;
}

// The runtimes the picker offers: Helena's own loop only where the instance switched it on
// (or the agent already runs on it), command and webhook only in an agent's own settings.
export function runtimeOptions({
  runtime,
  external,
  helena,
}: {
  runtime: AgentRuntimeKind;
  external: boolean;
  helena: boolean;
}): RuntimeChoice[] {
  const options: RuntimeChoice[] = ['claude', 'codex', 'local', 'hermes'];
  if (helena || runtime === 'helena') options.push('helena');
  if (external || runtime === 'command' || runtime === 'webhook')
    options.push('command', 'webhook');
  return options;
}

export default function RuntimePicker({
  runtime,
  model,
  reasoning,
  models,
  unavailable = [],
  disabled = false,
  external = false,
  helena = false,
  onChange,
}: {
  runtime: AgentRuntimeKind;
  model: string | null;
  reasoning: string | null;
  models: AiChatModel[];
  unavailable?: UnavailableChatModel[];
  disabled?: boolean;
  // Also offer "Befehl" (a checked script of the project) and "Webhook" (a signed call to
  // an outside service); only an agent's own settings do, never a chat.
  external?: boolean;
  // Also offer Helena's own loop (only where the instance switched it on).
  helena?: boolean;
  onChange: (runtime: AgentRuntimeKind, model: string | null, reasoning: string | null) => void;
}) {
  const t = useTranslations('chatWorkspace.runtimePicker');
  const choice = runtimeChoice(runtime, model);
  const availableModels = [...new Map(models.map((entry) => [entry.id, entry])).values()];
  const localModels = availableModels.filter((entry) => isLocalModel(entry.id));
  const runtimeModels = availableModels.filter((entry) =>
    choice === 'local'
      ? isLocalModel(entry.id)
      : choice === 'helena'
        ? entry.local || entry.id.startsWith('helena-')
        : !entry.local && !entry.id.startsWith('helena-'),
  );
  const helenaModels = availableModels.filter(
    (entry) => entry.local || entry.id.startsWith('helena-'),
  );
  // "Lokal" offers the agent's explicit tie to the instance's local standard model (it then
  // follows every switch of the local profile) and shows the NPU's models apart from the GPU's.
  const followsDefault = (choice === 'local' || choice === 'helena') && model === LOCAL_DEFAULT;
  const localGroups =
    choice === 'local'
      ? groupLocalModels(runtimeModels.filter((entry) => entry.id !== LOCAL_DEFAULT))
      : null;
  const selected = followsDefault
    ? {
        id: LOCAL_DEFAULT,
        name: t('localDefault'),
        thinkingLevels:
          runtimeModels.find((entry) => entry.id === LOCAL_DEFAULT)?.thinkingLevels ?? [],
      }
    : runtimeModels.find((entry) => entry.id === model);
  const withoutModel = runtime === 'command' || runtime === 'webhook';
  const options = runtimeOptions({ runtime, external, helena });
  const selectRuntime = (next: RuntimeChoice) => {
    if (next === 'local') {
      onChange('hermes', LOCAL_DEFAULT, null);
    } else if (next === 'helena') {
      onChange('helena', helenaModels[0]?.id ?? null, null);
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
            {options.map((option) => {
              const reason =
                (option === 'local' && localModels.length === 0) ||
                (option === 'helena' && helenaModels.length === 0)
                  ? t('localMissing')
                  : null;
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
      {!withoutModel && (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{t('model')}</span>
          <Select
            value={model ?? '__default__'}
            onValueChange={(value) =>
              onChange(runtime, value === '__default__' ? null : value, null)
            }
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
              {(choice === 'local' || choice === 'helena') && (
                <SelectItem value={LOCAL_DEFAULT}>{t('localDefault')}</SelectItem>
              )}
              {localGroups ? (
                <>
                  {localGroups.gpu.length > 0 && (
                    <SelectGroup>
                      {localGroups.npu.length > 0 && <SelectLabel>{t('localGpu')}</SelectLabel>}
                      {localGroups.gpu.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {localGroups.npu.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>{t('localNpu')}</SelectLabel>
                      {localGroups.npu.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {npuModelName(localModelName(entry.id))}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </>
              ) : (
                runtimeModels
                  .filter((entry) => entry.id !== LOCAL_DEFAULT)
                  .map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))
              )}
            </SelectContent>
          </Select>
        </div>
      )}
      {!withoutModel && (
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
      )}
    </div>
  );
}
