import { redirect } from 'next/navigation';
import { filesPath } from '@/utils/paths';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const [{ projectKey }, { path }] = await Promise.all([params, searchParams]);
  const prefix = `Projects/${projectKey}/`;
  const file = path?.startsWith(prefix) ? path.slice(prefix.length) : null;
  const folder = file?.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  redirect(filesPath(projectKey, folder, { file }));
}
