import { useTranslations } from 'next-intl';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type { Locale } from '@helena/locales';
import {
  PROJECT_PRESET_KEYS,
  presetIssueTypes,
  type ProjectPresetKey,
} from '@helena/locales/defaults';

// Picks the set of issue types a new project starts with and previews the result.
// The preview updates as the selection changes, so the outcome is visible before
// the project exists. The names come from the catalog the API creates them from, in
// the language the dialog sends with the request, so the list is what gets created.
export default function NewProjectPreset({
  value,
  locale,
  onChange,
}: {
  value: ProjectPresetKey;
  locale: Locale;
  onChange: (next: ProjectPresetKey) => void;
}) {
  const t = useTranslations('newProject');
  const types = presetIssueTypes(value, locale);

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium">{t('issueTypes')}</span>

      <RadioGroupPrimitive.Root
        value={value}
        onValueChange={(next) => onChange(next as ProjectPresetKey)}
        aria-label={t('issueTypes')}
        className="grid grid-cols-2 gap-x-2 gap-y-0.5"
      >
        {PROJECT_PRESET_KEYS.map((preset) => (
          <RadioGroupPrimitive.Item
            key={preset}
            value={preset}
            className={`rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              preset === value
                ? 'bg-secondary font-medium text-secondary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {t(`presets.${preset}`)}
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>

      {/* The type list wraps to two rows at most and the line below is one row, so
          the block keeps its height when the selection changes. */}
      <div className="space-y-2 rounded-lg bg-muted/60 p-3">
        <p className="text-xs text-muted-foreground">
          {t('typesCreated', { count: types.length })}
        </p>
        <div className="flex min-h-11 flex-wrap content-start gap-x-3 gap-y-1 text-sm">
          {types.map((type) => (
            <span key={type.key} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: type.color }}
              />
              {type.name}
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {t('defaultType', { type: types[0].name })}
        </p>
      </div>
    </div>
  );
}
