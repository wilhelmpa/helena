'use client';

import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AiChatModel } from '@/lib/api/endpoints/agentChat';
import type { AgentCompression, AgentRuntimePolicy } from '@/lib/api/endpoints/agents';
import BoundedNumberInput from './BoundedNumberInput';

const DEFAULT = '__default__';
const RATIOS = [0.1, 0.2, 0.3, 0.4, 0.5];
const IDLE_MINUTES = [0, 30, 60, 240, 1440];
export const COMPRESSION_THRESHOLD_BOUNDS = { min: 16_000, max: 1_000_000 } as const;

// How Hermes compresses a long conversation for this agent (docs/helena-decisions/
// agent-context.md §6): from how many tokens, what the compressed context keeps, whether a
// chat resumed after a pause is compressed first, and which model writes the summaries. A
// field left at its default takes the instance's threshold or Hermes' own value.
export default function AgentCompressionSettings({
  policy,
  models,
  canEdit,
  onChange,
}: {
  policy: AgentRuntimePolicy;
  models: AiChatModel[];
  canEdit: boolean;
  onChange: (policy: AgentRuntimePolicy) => void;
}) {
  const t = useTranslations('teams.agents.runtimePolicy.compression');
  const compression = policy.compression ?? {};
  const patch = (next: Partial<AgentCompression>) => {
    const merged: AgentCompression = { ...compression, ...next };
    for (const key of Object.keys(merged) as (keyof AgentCompression)[]) {
      if (merged[key] === undefined) delete merged[key];
    }
    onChange({ ...policy, compression: Object.keys(merged).length > 0 ? merged : undefined });
  };
  const choices = models.flatMap((model) =>
    model.provider ? [{ provider: model.provider, model: model.id, name: model.name }] : [],
  );
  // A model and its provider as one select value.
  const valueOf = (provider: string, model: string) => JSON.stringify([provider, model]);
  const modelValue = compression.model
    ? valueOf(compression.model.provider, compression.model.model)
    : DEFAULT;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{t('title')}</p>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t('threshold')}</span>
          <BoundedNumberInput
            className="h-8 w-full"
            bounds={COMPRESSION_THRESHOLD_BOUNDS}
            placeholder={t('thresholdPlaceholder')}
            disabled={!canEdit}
            value={compression.thresholdTokens}
            onValue={(thresholdTokens) => patch({ thresholdTokens })}
            ariaLabel={t('threshold')}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t('target')}</span>
          <Select
            disabled={!canEdit}
            value={
              compression.targetRatio === undefined ? DEFAULT : String(compression.targetRatio)
            }
            onValueChange={(value) =>
              patch({ targetRatio: value === DEFAULT ? undefined : Number(value) })
            }
          >
            <SelectTrigger className="w-full" aria-label={t('target')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>{t('targetDefault')}</SelectItem>
              {RATIOS.map((ratio) => (
                <SelectItem key={ratio} value={String(ratio)}>
                  {t('targetValue', { percent: Math.round(ratio * 100) })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t('idle')}</span>
          <Select
            disabled={!canEdit}
            value={String(compression.idleCompactMinutes ?? 0)}
            onValueChange={(value) =>
              patch({ idleCompactMinutes: value === '0' ? undefined : Number(value) })
            }
          >
            <SelectTrigger className="w-full" aria-label={t('idle')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IDLE_MINUTES.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {minutes === 0
                    ? t('idleOff')
                    : minutes < 60
                      ? t('idleMinutes', { minutes })
                      : t('idleHours', { hours: minutes / 60 })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t('model')}</span>
          <Select
            disabled={!canEdit}
            value={modelValue}
            onValueChange={(value) => {
              if (value === DEFAULT) return patch({ model: undefined });
              const [provider, model] = JSON.parse(value) as [string, string];
              patch({ model: { provider, model } });
            }}
          >
            <SelectTrigger className="w-full" aria-label={t('model')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>{t('modelDefault')}</SelectItem>
              {compression.model &&
                !choices.some(
                  (choice) =>
                    choice.provider === compression.model!.provider &&
                    choice.model === compression.model!.model,
                ) && (
                  <SelectItem value={modelValue}>
                    {compression.model.model} · {compression.model.provider}
                  </SelectItem>
                )}
              {choices.map((choice) => (
                <SelectItem
                  key={`${choice.provider}:${choice.model}`}
                  value={valueOf(choice.provider, choice.model)}
                >
                  {choice.name} · {choice.provider}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
    </div>
  );
}
