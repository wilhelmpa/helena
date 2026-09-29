import { redirect } from 'next/navigation';
import { organizationPath, teamListPath } from '@/utils/paths';

// A project's agents are the list view of its Team page now (Auftrag 117).
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectKey } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams))
    for (const item of Array.isArray(value) ? value : value == null ? [] : [value])
      query.append(key, item);
  redirect(teamListPath(organizationPath(projectKey), query.toString()));
}
