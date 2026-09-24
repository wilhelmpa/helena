'use client';

import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { InstanceEmailSettings } from '@/lib/api/endpoints/god';
import GodEmailSettings from './components/email/GodEmailSettings';
import GodSectionPage from './components/GodSectionPage';
import GodSettingsGate from './components/GodSettingsGate';
import { useGodEmailForm } from './hooks/useGodEmailForm';
import { useInstanceEmailSettingsQuery } from './services/god.service';
import PageSaveAction from '@/components/common/page/PageSaveAction';

export default function GodEmailPage() {
  const query = useInstanceEmailSettingsQuery();

  return (
    <GodSettingsGate slug="email" data={query.data}>
      {(settings) => <EmailForm settings={settings} />}
    </GodSettingsGate>
  );
}

function EmailForm({ settings }: { settings: InstanceEmailSettings }) {
  const t = useTranslations('god.email');
  const form = useGodEmailForm(settings);

  async function save() {
    try {
      await form.save();
      toast.success(t('saved'));
    } catch {
      // The failure already surfaced through the global mutation error toast.
    }
  }

  return (
    <GodSectionPage slug="email">
      <PageSaveAction onSave={() => void save()} disabled={!form.dirty} saving={form.saving} />
      <GodEmailSettings form={form} />
    </GodSectionPage>
  );
}
