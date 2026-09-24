import { useTranslations } from 'next-intl';
import type { CredentialEntry, LoginMethod, LoginRuntime } from '@/lib/api/endpoints/credentials';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LOGIN_METHODS, type CredentialFormValue } from '../../utils/credentialForm';
import { CredentialSecretInput } from './CredentialSecretInput';

const RUNTIMES: LoginRuntime[] = ['claude', 'codex'];

// A runtime login: the runtime it signs in, how, and the token or key itself. The hint
// says where the owner gets it; Helena never runs a sign-in of its own.
export function CredentialRuntimeLoginFields({
  value,
  entry,
  onChange,
}: {
  value: CredentialFormValue;
  entry: CredentialEntry | null;
  onChange: (patch: Partial<CredentialFormValue>) => void;
}) {
  const t = useTranslations('credentials');
  const methods = LOGIN_METHODS[value.runtime];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t('runtimeLogin.runtime')}</Label>
          <Select
            value={value.runtime}
            onValueChange={(next) => {
              const runtime = next as LoginRuntime;
              onChange({
                runtime,
                method: LOGIN_METHODS[runtime].includes(value.method)
                  ? value.method
                  : LOGIN_METHODS[runtime][0],
              });
            }}
          >
            <SelectTrigger className="w-full" aria-label={t('runtimeLogin.runtime')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RUNTIMES.map((runtime) => (
                <SelectItem key={runtime} value={runtime}>
                  {t(`runtimeLogin.runtimes.${runtime}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t('runtimeLogin.method')}</Label>
          <Select
            value={value.method}
            onValueChange={(next) => onChange({ method: next as LoginMethod })}
            disabled={methods.length < 2}
          >
            <SelectTrigger className="w-full" aria-label={t('runtimeLogin.method')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {methods.map((method) => (
                <SelectItem key={method} value={method}>
                  {t(`runtimeLogin.methods.${method}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <CredentialSecretInput
        label={t(`runtimeLogin.methods.${value.method}`)}
        hint={t(`runtimeLogin.hints.${value.runtime}_${value.method}`)}
        value={value.value}
        stored={entry?.secrets.includes('value') ?? false}
        onChange={(next) => onChange({ value: next })}
      />
    </div>
  );
}
