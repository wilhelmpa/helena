import { useTranslations } from 'next-intl';
import type { CredentialEntry } from '@/lib/api/endpoints/credentials';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { CredentialFormValue } from '../../utils/credentialForm';
import { CredentialDecisionModelFields } from './CredentialDecisionModelFields';
import { CredentialLoginFields } from './CredentialLoginFields';
import { CredentialRuntimeLoginFields } from './CredentialRuntimeLoginFields';
import { CredentialScopeSelect } from './CredentialScopeSelect';
import { CredentialSecretInput } from './CredentialSecretInput';
import { CredentialSshKey } from './CredentialSshKey';

// The fields of one credential: its name and scope, what its kind holds, and notes.
export function CredentialFields({
  teamId,
  value,
  entry,
  onChange,
  onKeyChange,
}: {
  teamId: number;
  value: CredentialFormValue;
  entry: CredentialEntry | null;
  onChange: (patch: Partial<CredentialFormValue>) => void;
  onKeyChange: (entry: CredentialEntry) => void;
}) {
  const t = useTranslations('credentials');
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="credential-label">{t('name')}</Label>
          <Input
            id="credential-label"
            value={value.label}
            placeholder={t(`namePlaceholders.${value.kind}`)}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </div>
        <CredentialScopeSelect
          teamId={teamId}
          value={value.projectId}
          onChange={(projectId) => onChange({ projectId })}
        />
      </div>

      {value.kind === 'web_login' && (
        <CredentialLoginFields value={value} entry={entry} onChange={onChange} />
      )}
      {(value.kind === 'api_key' || value.kind === 'secret') && (
        <CredentialSecretInput
          label={t('value')}
          value={value.value}
          stored={entry?.secrets.includes('value') ?? false}
          onChange={(next) => onChange({ value: next })}
        />
      )}
      {value.kind === 'runtime_login' && (
        <CredentialRuntimeLoginFields value={value} entry={entry} onChange={onChange} />
      )}
      {value.kind === 'decision_model' && (
        <CredentialDecisionModelFields
          teamId={teamId}
          value={value}
          entry={entry}
          onChange={onChange}
        />
      )}
      {value.kind === 'ssh_key' &&
        (entry ? (
          <CredentialSshKey teamId={teamId} entry={entry} onChange={onKeyChange} />
        ) : (
          <p className="rounded-md border border-sidebar-border bg-card px-3 py-2 text-sm text-muted-foreground">
            {t('ssh.generatedOnSave')}
          </p>
        ))}

      <div className="space-y-1.5">
        <Label htmlFor="credential-notes">{t('notes')}</Label>
        <Textarea
          id="credential-notes"
          rows={2}
          value={value.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>
    </div>
  );
}
