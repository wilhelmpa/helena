import { useTranslations } from 'next-intl';
import type { CredentialKind } from '@/lib/api/endpoints/credentials';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CREDENTIAL_KINDS } from '../../utils/credentialForm';

const ALL = 'all';

export function CredentialKindFilter({
  value,
  onChange,
}: {
  value: CredentialKind | undefined;
  onChange: (kind: CredentialKind | undefined) => void;
}) {
  const t = useTranslations('credentials');
  return (
    <Tabs
      value={value ?? ALL}
      onValueChange={(next) => onChange(next === ALL ? undefined : (next as CredentialKind))}
    >
      <TabsList>
        <TabsTrigger value={ALL}>{t('all')}</TabsTrigger>
        {CREDENTIAL_KINDS.map((kind) => (
          <TabsTrigger key={kind} value={kind}>
            {t(`kindsPlural.${kind}`)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
