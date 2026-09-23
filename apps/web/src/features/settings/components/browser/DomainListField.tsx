import { useState } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

// A domain: lowercase, no scheme, no path, no trailing dot. A leading "*." is dropped
// because a domain already covers its subdomains (same rule as the API, model.ts).
function normalizeDomain(raw: string): string | null {
  let domain = raw.trim().toLowerCase();
  domain = domain.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
  if (domain.startsWith('*.')) domain = domain.slice(2);
  if (domain.endsWith('.')) domain = domain.slice(0, -1);
  return domain.length > 0 && domain.length <= 253 ? domain : null;
}

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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={id}>{label}</Label>
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            overLimit ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {t('domainCount', { count: domains.length, max })}
        </span>
      </div>
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/50',
          disabled && 'opacity-60',
        )}
      >
        {domains.map((domain) => (
          <span
            key={domain}
            dir="ltr"
            className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
          >
            {domain}
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
          </span>
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
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
