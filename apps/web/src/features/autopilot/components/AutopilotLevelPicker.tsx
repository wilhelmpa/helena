'use client';

import { Card } from '@/design-system';
import { useTranslations } from 'next-intl';
import { AUTOPILOT_LEVELS, type AutopilotLevel } from '@/lib/api/endpoints/autopilot';
import { cn } from '@/lib/utils';

// The Autopilot as one control: four steps from "only propose" to "autonomous within the
// budget", the chosen one's meaning in a line below. Two by two on a phone.
export default function AutopilotLevelPicker({
  value,
  onChange,
  disabled,
  label,
}: {
  value: AutopilotLevel;
  onChange: (level: AutopilotLevel) => void;
  disabled?: boolean;
  label: string;
}) {
  const t = useTranslations('autopilot');
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {AUTOPILOT_LEVELS.map((level) => {
          const active = level === value;
          return (
            <Card
              as="button"
              type="button"
              role="radio"
              aria-checked={active}
              tone="inset"
              interactive
              selected={active}
              pad="tight"
              gap={1}
              key={level}
              disabled={disabled}
              onClick={() => onChange(level)}
              className="min-h-16 items-start disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-accent text-muted-foreground',
                  )}
                >
                  {level}
                </span>
                <span className="text-sm font-medium">{t(`level.${level}.name`)}</span>
              </span>
              {/* A rising bar: how much the agents do on their own. */}
              <span className="flex w-full gap-0.5" aria-hidden>
                {AUTOPILOT_LEVELS.map((step) => (
                  <span
                    key={step}
                    className={cn(
                      'h-1 flex-1 rounded-full',
                      step <= level
                        ? active
                          ? 'bg-primary'
                          : 'bg-muted-foreground/40'
                        : 'bg-border',
                    )}
                  />
                ))}
              </span>
            </Card>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">{t(`level.${value}.description`)}</p>
    </div>
  );
}
