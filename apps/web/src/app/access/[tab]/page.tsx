import { redirect } from 'next/navigation';
import { accessPath, isAccessTab } from '@/utils/paths';

// The old address of a tab of Zugänge & Verbindungen (bookmarks, the Google and MCP
// sign-in callbacks): the page in Helena's settings, with the query it came with.
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tab } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (key === 'tab') continue;
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
      query.append(key, item);
  }
  const rest = query.toString();
  redirect(`${accessPath(isAccessTab(tab) ? tab : 'google')}${rest ? `&${rest}` : ''}`);
}
