'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { manageTeamsPath } from '@/utils/paths';
import { useTeamsQuery } from '@/services/teams.service';

// One team. Its sections are listed in the account sidebar and each is a route of its
// own that loads only what it shows. A team the account is no longer in falls back to
// the first one left.
export default function TeamLayout({ teamId, children }: { teamId: number; children: ReactNode }) {
  const router = useRouter();
  const { data } = useTeamsQuery();
  const team = data?.find((entry) => entry.id === teamId) ?? null;

  useEffect(() => {
    if (data && !team) router.replace(manageTeamsPath());
  }, [data, team, router]);

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>;
}
