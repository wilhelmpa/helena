'use client';

import { useId } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FallbackModel } from '@/lib/api/endpoints/agents';

// Hermes' fallback chain (fallback_providers): the models a run switches to, in order, when
// its own model fails or is rate-limited. Each entry is a provider Hermes knows (openrouter,
// anthropic, openai-codex, a custom endpoint's name …) and a model id of that provider.
export const MAX_FALLBACK_MODELS = 8;

export default function FallbackModelsEditor({
  value,
  onChange,
  disabled,
  suggestions = [],
}: {
  value: FallbackModel[];
  onChange: (next: FallbackModel[]) => void;
  disabled?: boolean;
  // Known provider/model pairs (the model catalog), offered as the fields' completions.
  suggestions?: FallbackModel[];
}) {
  const t = useTranslations('agentRuntime.fallback');
  const listId = useId();
  const providers = [...new Set(suggestions.map((entry) => entry.provider))];
  const update = (index: number, patch: Partial<FallbackModel>) =>
    onChange(value.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...value];
    const [entry] = next.splice(index, 1);
    next.splice(index + by, 0, entry!);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-sm text-muted-foreground">{t('none')}</p>}
      <ol className="space-y-2">
        {value.map((entry, index) => (
          <li key={index} className="flex items-center gap-1.5">
            <span className="w-5 shrink-0 text-end text-xs text-muted-foreground tabular-nums">
              {index + 1}.
            </span>
            <Input
              className="h-8 w-36 shrink-0"
              value={entry.provider}
              disabled={disabled}
              maxLength={64}
              placeholder={t('provider')}
              aria-label={t('provider')}
              dir="ltr"
              list={`${listId}-providers`}
              onChange={(event) => update(index, { provider: event.target.value })}
            />
            <Input
              className="h-8 min-w-0 flex-1"
              value={entry.model}
              disabled={disabled}
              maxLength={200}
              placeholder={t('model')}
              aria-label={t('model')}
              dir="ltr"
              list={`${listId}-models`}
              onChange={(event) => update(index, { model: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={t('up')}
              disabled={disabled || index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={t('down')}
              disabled={disabled || index === value.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={t('remove')}
              disabled={disabled}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <X />
            </Button>
          </li>
        ))}
      </ol>
      <datalist id={`${listId}-providers`}>
        {providers.map((provider) => (
          <option key={provider} value={provider} />
        ))}
      </datalist>
      <datalist id={`${listId}-models`}>
        {suggestions.map((entry) => (
          <option key={`${entry.provider}/${entry.model}`} value={entry.model}>
            {entry.provider}
          </option>
        ))}
      </datalist>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || value.length >= MAX_FALLBACK_MODELS}
        onClick={() => onChange([...value, { provider: '', model: '' }])}
      >
        <Plus />
        {t('add')}
      </Button>
    </div>
  );
}
