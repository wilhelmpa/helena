import { useTranslations } from 'next-intl';
import type { CredentialEntry } from '@/lib/api/endpoints/credentials';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { CredentialFormValue } from '../../utils/credentialForm';
import { CredentialSecretInput } from './CredentialSecretInput';

// A website login: where it is used, the account, and its secrets.
export function CredentialLoginFields({
  value,
  entry,
  onChange,
}: {
  value: CredentialFormValue;
  entry: CredentialEntry | null;
  onChange: (patch: Partial<CredentialFormValue>) => void;
}) {
  const t = useTranslations('credentials');
  const stored = (field: string) => entry?.secrets.includes(field) ?? false;
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="credential-login-url">{t('loginUrl')}</Label>
        <Input
          id="credential-login-url"
          dir="ltr"
          type="url"
          value={value.loginUrl}
          placeholder="https://github.com/login"
          onChange={(e) => onChange({ loginUrl: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="credential-domains">{t('allowedDomains')}</Label>
        <Textarea
          id="credential-domains"
          dir="ltr"
          rows={2}
          className="font-mono text-xs"
          value={value.allowedDomains}
          placeholder="gist.github.com"
          onChange={(e) => onChange({ allowedDomains: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('allowedDomainsHint')}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="credential-username">{t('username')}</Label>
        <Input
          id="credential-username"
          dir="ltr"
          autoComplete="off"
          value={value.username}
          onChange={(e) => onChange({ username: e.target.value })}
        />
      </div>
      <CredentialSecretInput
        label={t('password')}
        value={value.password}
        stored={stored('password')}
        onChange={(password) => onChange({ password })}
      />
      <CredentialSecretInput
        label={t('totpSecret')}
        hint={t('totpHint')}
        optional
        value={value.totpSecret}
        stored={stored('totpSecret')}
        removed={value.removeTotp}
        onChange={(totpSecret) => onChange({ totpSecret, removeTotp: false })}
        onRemove={(removeTotp) => onChange({ removeTotp, totpSecret: '' })}
      />
    </>
  );
}
