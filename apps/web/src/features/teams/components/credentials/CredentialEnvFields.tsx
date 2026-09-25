import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ENV_NAME_PATTERN, envNameOf, type CredentialFormValue } from '../../utils/credentialForm';

// The name the agents' commands get a credential in (docs/helena-decisions/agent-env.md):
// for an API key or secret behind "Als Umgebungsvariable an Agenten geben", for a plain
// variable always.
export function CredentialEnvName({
  value,
  onChange,
}: {
  value: CredentialFormValue;
  onChange: (patch: Partial<CredentialFormValue>) => void;
}) {
  const t = useTranslations('credentials.env');
  const invalid = value.envName !== '' && !ENV_NAME_PATTERN.test(value.envName);
  return (
    <div className="space-y-1.5">
      <Label htmlFor="credential-env-name">{t('name')}</Label>
      <Input
        id="credential-env-name"
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        className="font-mono"
        value={value.envName}
        placeholder={value.kind === 'variable' ? 'CLOUDFLARE_ACCOUNT_ID' : 'CLOUDFLARE_API_TOKEN'}
        aria-invalid={invalid}
        onChange={(e) => onChange({ envName: envNameOf(e.target.value) })}
      />
      <p className="text-xs text-muted-foreground">{invalid ? t('nameInvalid') : t('nameHint')}</p>
    </div>
  );
}

export function CredentialEnvFields({
  value,
  onChange,
}: {
  value: CredentialFormValue;
  onChange: (patch: Partial<CredentialFormValue>) => void;
}) {
  const t = useTranslations('credentials.env');
  return (
    <div className="space-y-3 rounded-md border border-sidebar-border bg-card px-3 py-2.5">
      <label className="flex cursor-pointer items-center justify-between gap-2">
        <span>
          <span className="text-sm">{t('toggle')}</span>
          <span className="block text-xs text-muted-foreground">{t('toggleHint')}</span>
        </span>
        <Switch
          checked={value.envEnabled}
          onCheckedChange={(envEnabled) => onChange({ envEnabled })}
        />
      </label>
      {value.envEnabled && <CredentialEnvName value={value} onChange={onChange} />}
    </div>
  );
}
