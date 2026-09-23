import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';

export default function AgentTemplateField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (template: boolean) => void;
}) {
  const t = useTranslations('teams.agents');

  return (
    <label className="flex cursor-pointer items-start gap-2">
      <Checkbox
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <span>
        <span className="text-sm font-medium">{t('template')}</span>
        <span className="block text-xs text-muted-foreground">{t('templateHint')}</span>
      </span>
    </label>
  );
}
