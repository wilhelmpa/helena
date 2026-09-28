import HelenaSettingsPage from '@/features/settings/HelenaSettingsPage';

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return <HelenaSettingsPage section={section} />;
}
