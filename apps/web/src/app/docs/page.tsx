import { redirect } from 'next/navigation';
import { homeFilesPath, vaultNotePath } from '@/utils/paths';

export default async function Page({ searchParams }: { searchParams: Promise<{ path?: string }> }) {
  const { path } = await searchParams;
  redirect(path ? vaultNotePath(path) : homeFilesPath('Docs'));
}
