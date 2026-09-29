import { redirect } from 'next/navigation';
import { teamListPath, teamOrganizationPath } from '@/utils/paths';

// The agent pool is the list view of Team now (Auftrag 117); an old address (a bookmark,
// a chat command's ?agent=7&tab=runs) lands there with what it named.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(teamListPath(teamOrganizationPath(), queryString(await searchParams)));
}

function queryString(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    for (const item of Array.isArray(value) ? value : value == null ? [] : [value])
      query.append(key, item);
  return query.toString();
}
