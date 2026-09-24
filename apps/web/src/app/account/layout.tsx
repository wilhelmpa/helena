import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import AccountShell from '@/components/common/page/AccountShell';

// The account area (profile, preferences, linked accounts, security, API keys and the
// teams) has its own sidebar in the same frame as the main app and the Administrator.
// The sidebar open/collapsed state uses the same `sidebar_state` cookie, so the sidebar
// keeps its width across the three.
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const defaultSidebarOpen = cookieStore.get('sidebar_state')?.value !== 'false';
  return <AccountShell defaultSidebarOpen={defaultSidebarOpen}>{children}</AccountShell>;
}
