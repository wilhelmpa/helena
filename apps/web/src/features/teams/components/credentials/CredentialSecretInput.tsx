import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// A write-only field. A stored value is never shown: the field says that one is stored,
// and "Replace" opens an empty input whose value replaces it on save. `onRemove` offers
// to clear an optional stored value instead.
export function CredentialSecretInput({
  label,
  hint,
  optional = false,
  value,
  stored,
  removed = false,
  onChange,
  onRemove,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  value: string;
  stored: boolean;
  removed?: boolean;
  onChange: (value: string) => void;
  onRemove?: (removed: boolean) => void;
}) {
  const t = useTranslations('credentials');
  const id = useId();
  const [replacing, setReplacing] = useState(false);
  const editing = !stored || replacing;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="text-muted-foreground"> ({t('optional')})</span>}
      </Label>
      {editing ? (
        <div className="flex gap-2">
          <Input
            id={id}
            dir="ltr"
            type="password"
            autoComplete="new-password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {stored && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onChange('');
                setReplacing(false);
              }}
            >
              {t('keep')}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            {removed ? (
              t('removed')
            ) : (
              <>
                <Check className="size-3.5" />
                {t('stored')}
              </>
            )}
          </span>
          <div className="flex gap-1">
            {removed ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => onRemove?.(false)}>
                {t('keep')}
              </Button>
            ) : (
              <>
                {onRemove && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(true)}>
                    {t('remove')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setReplacing(true)}
                >
                  {t('replace')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{hint ?? t('secretHint')}</p>
    </div>
  );
}
