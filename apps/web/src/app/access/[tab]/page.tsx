import { redirect } from 'next/navigation';
import AccessCenterPage from '@/features/access/AccessCenterPage';
import { accessPath, isAccessTab } from '@/utils/paths';

export default async function Page({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (!isAccessTab(tab)) redirect(accessPath());
  return <AccessCenterPage tab={tab} />;
}
