import { redirect } from 'next/navigation';
import ServerPage from '@/features/server/ServerPage';
import { isServerTab } from '@/features/server/utils/serverFormat';
import { serverPath } from '@/utils/paths';

export default async function Page({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (!isServerTab(tab)) redirect(serverPath('overview'));
  return <ServerPage tab={tab} />;
}
