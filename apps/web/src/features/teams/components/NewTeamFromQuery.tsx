'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { teamPath } from '@/utils/paths';
import NewTeamModal from './NewTeamModal';

// The "New team" dialog, opened by `?new=1` on any team route (the account sidebar's
// team switcher links there).
export default function NewTeamFromQuery() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get('new') === '1';
  const [creating, setCreating] = useState(false);

  // Opened once per request; the parameter is dropped at once so a reload or the back
  // button does not open it again.
  useEffect(() => {
    if (!requested) return;
    setCreating(true);
    router.replace(pathname);
  }, [requested, pathname, router]);

  if (!creating) return null;
  return (
    <NewTeamModal
      onClose={() => setCreating(false)}
      onCreated={(team) => router.push(teamPath(team.id))}
    />
  );
}
