import { Check } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { useTranslations } from 'next-intl';
import { AGENT_NETWORK_MODES, type AgentNetworkMode } from '@/lib/api/endpoints/agentNetwork';
import { cn } from '@/lib/utils';

// Picks how the project's isolated agents reach the internet: every public
// destination but the deny list, or only the ones on the allow list (the deny list
// still applies either way). Renders bare rows — the caller wraps them in a
// SettingsCard.
export default function AgentNetworkModePicker({
  value,
  onChange,
  disabled,
}: {
  value: AgentNetworkMode;
  onChange: (value: AgentNetworkMode) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('settings.network.mode');

  return (
    // Radix RadioGroup: one tab stop, the arrow keys move the choice (WAI-ARIA radio group).
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(next) => onChange(next as AgentNetworkMode)}
      disabled={disabled}
    >
      {AGENT_NETWORK_MODES.map((mode) => {
        const active = value === mode;
        return (
          <RadioGroupPrimitive.Item
            key={mode}
            value={mode}
            className={cn(
              'flex w-full items-start gap-3 p-4 text-left transition-colors',
              '-outline-offset-1 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
              // The choice reads from the fill, not from a box around it. The rows sit
              // inside a SettingsCard, which supplies the dividers and the rounding.
              active ? 'bg-accent' : 'hover:bg-accent/40',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                active ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
              )}
            >
              {active && <Check className="size-3" />}
            </span>
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">{t(`${mode}.label`)}</span>
              <span className="block text-xs text-muted-foreground">
                {t(`${mode}.description`)}
              </span>
            </span>
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
