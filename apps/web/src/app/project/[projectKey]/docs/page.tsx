import { redirect } from 'next/navigation';
import { filesPath, vaultNotePath } from '@/utils/paths';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const { projectKey } = await params;
  const { path } = await searchParams;
  redirect(path ? vaultNotePath(path) : filesPath(projectKey, 'Docs'));
}
