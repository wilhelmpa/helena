'use client';

import Link from 'next/link';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Team } from '@/lib/api/endpoints/teams';
import { manageTeamsPath, teamPath } from '@/utils/paths';
import { SidebarGroupLabel } from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// The label of the account sidebar's team group, and the way to another team: it names
// the team whose sections follow and opens the list of the reader's teams, with
// "New team" at its end. The sidebar's own group label, made a quiet 32px control.
export default function AccountTeamSwitcher({
  teams,
  current,
}: {
  teams: Team[];
  current: Team | null;
}) {
  const t = useTranslations('teams.manage');
  return (
    <DropdownMenu>
      <SidebarGroupLabel asChild>
        <DropdownMenuTrigger className="w-full gap-1.5 text-start transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent/60">
          <span className="min-w-0 flex-1 truncate">{current?.name ?? t('teams')}</span>
          <ChevronsUpDown className="!size-3.5 text-muted-foreground" aria-hidden="true" />
        </DropdownMenuTrigger>
      </SidebarGroupLabel>
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-52"
      >
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t('teams')}
        </DropdownMenuLabel>
        {teams.map((team) => (
          <DropdownMenuItem key={team.id} asChild>
            <Link href={teamPath(team.id)}>
              <span className="min-w-0 flex-1 truncate">{team.name}</span>
              <span className="text-xs text-muted-foreground">{t(`roles.${team.role}`)}</span>
              {team.id === current?.id ? <Check className="text-muted-foreground" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        {teams.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem asChild>
          <Link href={`${manageTeamsPath()}?new=1`}>
            <Plus />
            {t('newTeam')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
