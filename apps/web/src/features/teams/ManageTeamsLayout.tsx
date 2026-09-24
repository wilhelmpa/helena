'use client';

import { Suspense, type ReactNode } from 'react';
import NewTeamFromQuery from './components/NewTeamFromQuery';

// The team routes. The list of teams and each team's sections live in the account
// sidebar (see AccountShell), so this layout only holds the "New team" dialog, which
// the sidebar's team switcher opens through `?new=1` — a link, so it works from any
// page of the account area.
export default function ManageTeamsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Suspense>
        <NewTeamFromQuery />
      </Suspense>
    </>
  );
}
