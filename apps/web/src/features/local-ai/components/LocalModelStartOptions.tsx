'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button, Field, TextField } from '@/design-system';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LocalModel, LocalModelStartOptions } from '@/lib/api/endpoints/localAi';
import { useUpdateModelOptions } from '../services/localAi.service';
import {
  EMPTY_START_OPTIONS,
  draftFromOptions,
  hasStartOptions,
  parseStartOptions,
  sameStartOptions,
  type StartOptionsDraft,
} from '../utils/modelStartOptions';

// Select values: a Radix select item cannot be empty, so Lemonade's default has a name.
const DEFAULT = 'default';
type Backend = NonNullable<LocalModelStartOptions['backend']>;
type SpecType = NonNullable<LocalModelStartOptions['specType']>;
const BACKENDS: Backend[] = ['rocm', 'vulkan'];
const SPEC_TYPES: SpecType[] = ['draft-mtp', 'draft-dflash'];

// "Startoptionen" of one model on a Lemonade server: backend, speculative decoding, parallel
// slots and the context of each. A mistake shows as a line under its field; nothing is
// sent until the form is right. Lemonade reads the options at the model's next start.
export default function LocalModelStartOptions({
  serverId,
  model,
  onDone,
}: {
  serverId: number;
  model: LocalModel;
  onDone: () => void;
}) {
  const t = useTranslations('localAi.startOptions');
  const tCommon = useTranslations('common');
  const save = useUpdateModelOptions();
  const [draft, setDraft] = useState<StartOptionsDraft>(() => draftFromOptions(model.startOptions));
  // Mistakes show once the owner tried to save, so an empty form does not start red.
  const [tried, setTried] = useState(false);
  const id = useId();
  const parsed = parseStartOptions(draft);
  const errors = tried ? parsed.errors : {};
  const unchanged = parsed.options !== null && sameStartOptions(parsed.options, model.startOptions);

  function change<K extends keyof StartOptionsDraft>(key: K, value: StartOptionsDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function submit(options: LocalModelStartOptions | null) {
    setTried(true);
    if (!options) return;
    save.mutate(
      { serverId, model: model.id, options },
      {
        onSuccess: () => {
          toast.success(t('saved', { name: model.name }));
          onDone();
        },
      },
    );
  }

  const error = (key: keyof typeof parsed.errors) => {
    const code = errors[key];
    return code ? t(`errors.${code}`) : undefined;
  };

  return (
    <form
      className="flex w-full flex-col gap-4 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit(parsed.options);
      }}
    >
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('backend')} hint={t('backendHint')} htmlFor={`${id}-backend`}>
          <Select
            value={draft.backend ?? DEFAULT}
            onValueChange={(value) =>
              change('backend', value === DEFAULT ? null : (value as Backend))
            }
          >
            <SelectTrigger id={`${id}-backend`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>{t('backends.default')}</SelectItem>
              {BACKENDS.map((backend) => (
                <SelectItem key={backend} value={backend}>
                  {t(`backends.${backend}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('spec')} hint={t('specHint')} htmlFor={`${id}-spec`}>
          <Select
            value={draft.specType ?? DEFAULT}
            onValueChange={(value) =>
              change('specType', value === DEFAULT ? null : (value as SpecType))
            }
          >
            <SelectTrigger id={`${id}-spec`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>{t('specTypes.off')}</SelectItem>
              {SPEC_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`specTypes.${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {draft.specType === 'draft-dflash' && (
          <Field
            label={t('draftModel')}
            hint={t('draftModelHint')}
            error={error('draftModel')}
            htmlFor={`${id}-draft-model`}
          >
            <TextField
              id={`${id}-draft-model`}
              dir="ltr"
              value={draft.draftModel}
              placeholder="/var/lib/helena-ai/models/…/draft.gguf"
              onChange={(event) => change('draftModel', event.target.value)}
            />
          </Field>
        )}
        {draft.specType !== null && (
          <Field
            label={t('draftTokens')}
            hint={t('draftTokensHint')}
            error={error('draftTokens')}
            htmlFor={`${id}-draft-tokens`}
          >
            <TextField
              id={`${id}-draft-tokens`}
              inputMode="numeric"
              value={draft.draftTokens}
              placeholder={t('defaultPlaceholder')}
              onChange={(event) => change('draftTokens', event.target.value)}
            />
          </Field>
        )}
        <Field
          label={t('parallel')}
          hint={t('parallelHint')}
          error={error('parallel')}
          htmlFor={`${id}-parallel`}
        >
          <TextField
            id={`${id}-parallel`}
            inputMode="numeric"
            value={draft.parallel}
            placeholder={t('defaultPlaceholder')}
            onChange={(event) => change('parallel', event.target.value)}
          />
        </Field>
        <Field
          label={t('contextPerSlot')}
          hint={t('contextPerSlotHint')}
          error={error('contextPerSlot')}
          htmlFor={`${id}-context`}
        >
          <TextField
            id={`${id}-context`}
            inputMode="numeric"
            value={draft.contextPerSlot}
            placeholder={t('defaultPlaceholder')}
            onChange={(event) => change('contextPerSlot', event.target.value)}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {hasStartOptions(model.startOptions) && (
          <Button
            variant="ghost"
            size="small"
            disabled={save.isPending}
            onClick={() => submit(EMPTY_START_OPTIONS)}
          >
            {t('reset')}
          </Button>
        )}
        <Button variant="ghost" size="small" onClick={onDone}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" size="small" disabled={save.isPending || unchanged}>
          {save.isPending ? tCommon('saving') : tCommon('save')}
        </Button>
      </div>
    </form>
  );
}
