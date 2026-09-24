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

  return (
    <div className="flex w-fit items-center gap-0.5" role="tablist">
      {options.map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(option)}
            className={cn(
              'inline-flex h-7 items-center rounded-md px-2.5 text-sm transition-colors outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50',
              active
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            {label(option)}
          </button>
        );
      })}
    </div>
  );
}
