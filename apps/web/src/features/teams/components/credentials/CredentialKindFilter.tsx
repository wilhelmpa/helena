import { Layers } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CredentialKind } from '@/lib/api/endpoints/credentials';
import { PageTabs } from '@/components/layout/PageToolbar';
import { CREDENTIAL_KINDS } from '../../utils/credentialForm';
import { CREDENTIAL_KIND_ICONS } from './CredentialKindIcon';

const ALL = 'all';
type KindTab = CredentialKind | typeof ALL;

// The kind filter of the credentials page, as the view tabs of its toolbar row.
export function CredentialKindFilter({
  value,
  onChange,
}: {
  value: CredentialKind | undefined;
  onChange: (kind: CredentialKind | undefined) => void;
}) {
  const t = useTranslations('credentials');
  return (
    <PageTabs<KindTab>
      label={t('title')}
      value={value ?? ALL}
      onChange={(next) => onChange(next === ALL ? undefined : next)}
      items={[
        { value: ALL, label: t('all'), icon: Layers },
        ...CREDENTIAL_KINDS.map((kind) => ({
          value: kind,
          label: t(`kindsPlural.${kind}`),
          icon: CREDENTIAL_KIND_ICONS[kind],
        })),
      ]}
    />
  );
}
