'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import { useHydrated } from '@/components/common/page/useHydrated';
import { qk } from '@/services/queryKeys';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import { useApiKeysQuery, type ApiKeyRow } from './services/apiKeys.service';
import ApiKeysCreateSection from './components/ApiKeysCreateSection';
import ApiKeysList from './components/ApiKeysList';
import ApiKeysDeleteDialog from './components/ApiKeysDeleteDialog';

// Personal API keys for the signed-in account. Owns the key list query and the
// delete target; the child components refresh the list through the callbacks
// after a change.
export default function ApiKeysPage() {
  const t = useTranslations('apiKeys');
  const { data: session } = useSession();
  // The session is in the store on hydration but not on the server: read it after.
  const email = (useHydrated() && session?.user.email) || '…';
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<ApiKeyRow | null>(null);

  const { data: apiKeys, isPending } = useApiKeysQuery();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.apiKeys });

  return (
    <SectionPageView title={t('title')} description={t('description', { email })} wide>
      <ApiKeysCreateSection onCreated={invalidate} />
      <SettingsSection title={t('sectionTitle')}>
        <SettingsCard className="divide-y">
          <ApiKeysList apiKeys={apiKeys ?? []} isPending={isPending} onDelete={setDeleting} />
        </SettingsCard>
      </SettingsSection>

      {deleting && (
        <ApiKeysDeleteDialog
          apiKey={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null);
            await invalidate();
          }}
        />
      )}
    </SectionPageView>
  );
}
