import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

// 'system' is the instance provider a team can send through; it carries no
// credentials of its own, so it is only offered where that choice exists.
export type EmailProvider = 'system' | 'smtp' | 'resend';

// A segmented control choosing which email provider is configured. Only one email
// provider is active at a time, so this picks both the visible form and the channel
// that sends. Sidebar rows side by side, like every tab row in the app.
export default function ProviderToggle({
  value,
  onChange,
  options = ['smtp', 'resend'],
  disabled,
}: {
  value: EmailProvider;
  onChange: (value: EmailProvider) => void;
  options?: EmailProvider[];
  disabled?: boolean;
}) {
  const t = useTranslations('common');
  // Only the instance provider is named in words; the other two are product names.
  const label = (option: EmailProvider) =>
    option === 'system' ? t('system') : option === 'smtp' ? 'SMTP' : 'Resend';

  // One choice of a few: a Radix ToggleGroup (single), whose items are radios with one tab
  // stop and arrow-key movement. It used to call itself a tablist without tab panels.
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      // A second press on the chosen option would clear it; one is always chosen.
      onValueChange={(next) => next && onChange(next as EmailProvider)}
      disabled={disabled}
      className="flex w-fit items-center gap-0.5"
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option}
          value={option}
          className={cn(
            'inline-flex h-7 items-center rounded-md px-2.5 text-sm transition-colors outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50',
            'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            'data-[state=on]:bg-accent data-[state=on]:font-medium data-[state=on]:text-foreground',
          )}
        >
          {label(option)}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
