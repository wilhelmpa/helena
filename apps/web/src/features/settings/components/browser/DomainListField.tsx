import { useState } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { normalizeDomain } from '../../utils/domainList';

import { Stack, Inline, Text } from '@/design-system';

// A domain list edited as chips: type a domain, press Enter/comma/space or blur to add
// it, backspace on the empty field to drop the last one. Used for the browser gateway's
// blocklist and allowlist (SettingsBrowserGateway.tsx); each change is committed to the
// parent at once, which saves it immediately, matching the rest of the page.
export default function DomainListField({
  id,
  label,
  domains,
  onChange,
  disabled,
  max,
  hint,
}: {
  id: string;
  label: string;
  domains: string[];
  onChange: (domains: string[]) => void;
  disabled: boolean;
  max: number;
  hint?: string;
}) {
  const t = useTranslations('settings.browser');
  const [draft, setDraft] = useState('');
  const overLimit = domains.length > max;

  const add = () => {
    const domain = normalizeDomain(draft);
    setDraft('');
    if (domain && !domains.includes(domain) && domains.length < max) onChange([...domains, domain]);
  };

  return (
    <Stack gap={2}>
      <Inline gap={4} justify="between" className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            overLimit ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {t('domainCount', { count: domains.length, max })}
        </span>
      </Inline>
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/50',
          disabled && 'opacity-60',
        )}
      >
        {domains.map((domain) => (
          <Inline
            as="span"
            gap={1}
            padX={2}
            padY={1}
            key={domain}
            dir="ltr"
            className="rounded-sm bg-muted"
          >
            <Text as="span" size="xs" className="font-mono">
              {domain}
            </Text>
            {!disabled && (
              <button
                type="button"
                className="rounded-sm text-muted-foreground hover:text-foreground"
                aria-label={t('removeDomain', { domain })}
                onClick={() => onChange(domains.filter((other) => other !== domain))}
              >
                <X className="size-3" />
              </button>
            )}
          </Inline>
        ))}
        {!disabled && (
          <input
            id={id}
            value={draft}
            dir="ltr"
            className="h-6 min-w-32 flex-1 bg-transparent px-1 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground"
            placeholder={domains.length === 0 ? t('domainPlaceholder') : ''}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={add}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
                event.preventDefault();
                add();
              } else if (event.key === 'Backspace' && !draft && domains.length > 0) {
                onChange(domains.slice(0, -1));
              }
            }}
          />
        )}
      </div>
      {hint && (
        <Text as="p" size="xs" tone="muted">
          {hint}
        </Text>
      )}
    </Stack>
  );
}
