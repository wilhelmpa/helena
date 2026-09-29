'use client';

import { useState } from 'react';
import { Bot, Plus, UserRound, UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { InviteRow } from '@/lib/api/endpoints/invites';
import type { MemberKind } from '@/lib/api/endpoints/members';
import type { TeamMember } from '@/lib/api/endpoints/teams';
import {
  useDeleteTeamInvite,
  useRemoveTeamMember,
  useTeam,
  useTeamInvitesQuery,
  useTeamMembersQuery,
} from '@/services/teams.service';
import { useRouter } from 'next/navigation';
import { useSearchTerm } from '@/hooks/useSearchTerm';
import { useSession } from '@/lib/auth-client';
import { teamSectionPath } from '@/utils/paths';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import ListPager from '@/components/common/ListPager';
import { usePaging } from '@/hooks/usePaging';
import SectionPageView from '@/components/common/page/SectionPageView';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import MembersEmptyState from '@/components/common/page/MembersEmptyState';
import TeamInviteDialog from './TeamInviteDialog';
import TeamInviteRow from './TeamInviteRow';
import TeamMemberRow from './TeamMemberRow';
import {
  PageActions,
  PageSearch,
  PageTabs,
  PageToolbar,
  PageToolbarSpacer,
} from '@/components/layout/PageToolbar';
import TableCard from '@/components/common/page/TableCard';
import { Table, Th, Tr } from '@/design-system';

// The team's members, a page at a time, with the invites that have not been answered
// yet above them. People and agents work on one board, so both are listed and the tabs
// tell them apart; selecting an agent opens the section that configures it. Owners and
// managers run the list, so only they invite and see the pending invites; only an owner
// removes a person from it.
export default function TeamMembersSection({
  teamId,
  humansOnly = false,
}: {
  teamId: number;
  // Organisation › Menschen (owner, O34): people only; the agents live in Team.
  humansOnly?: boolean;
}) {
  const t = useTranslations('teams');
  const tMembers = useTranslations('members');
  const tInvite = useTranslations('teams.invite');
  const tCommon = useTranslations('common');
  const team = useTeam(teamId);
  const [kind, setKind] = useState<MemberKind>(humansOnly ? 'human' : 'all');
  const { search, setSearch, term } = useSearchTerm();
  const paging = usePaging();
  const membersQuery = useTeamMembersQuery(teamId, { search: term, kind, ...paging.params });
  const canInvite = team != null && team.role !== 'member';
  const invitesQuery = useTeamInvitesQuery(teamId, canInvite);
  const deleteInvite = useDeleteTeamInvite(teamId);
  const removeMember = useRemoveTeamMember(teamId);
  const [inviting, setInviting] = useState(false);
  const [target, setTarget] = useState<InviteRow | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const router = useRouter();
  const { data: session } = useSession();

  const members = membersQuery.data?.items ?? [];
  const total = membersQuery.data?.total ?? 0;
  // An invite is nobody yet, so it matches no tab and no search term: the rows only
  // stand above the first page of the plain list.
  const pending =
    paging.params.page === 1 && kind !== 'agent' && term === undefined
      ? (invitesQuery.data ?? []).filter((invite) => invite.status === 'pending')
      : [];

  function onKindChange(next: MemberKind) {
    setKind(next);
    paging.reset();
  }

  function onSearchChange(next: string) {
    setSearch(next);
    paging.reset();
  }

  // The placeholder names what the open tab holds, so the search says what it covers.
  const searchPlaceholder = {
    all: tMembers('search.all'),
    human: tMembers('search.people'),
    agent: tMembers('search.agents'),
  }[kind];

  return (
    <SectionPageView title={t('sections.members.title')} wide>
      <PageToolbar>
        {!humansOnly && (
          <PageTabs<MemberKind>
            label={t('sections.members.title')}
            value={kind}
            onChange={onKindChange}
            items={[
              { value: 'all', label: tMembers('tabs.all'), icon: UsersRound },
              { value: 'human', label: tMembers('tabs.people'), icon: UserRound },
              { value: 'agent', label: tMembers('tabs.agents'), icon: Bot },
            ]}
          />
        )}
        <PageToolbarSpacer />
        <PageSearch value={search} onChange={onSearchChange} placeholder={searchPlaceholder} />
        <PageActions
          primary={
            canInvite
              ? {
                  id: 'invite',
                  label: tInvite('action'),
                  icon: Plus,
                  onClick: () => setInviting(true),
                }
              : undefined
          }
        />
      </PageToolbar>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {membersQuery.isPending ? (
          <ListSkeleton rows={4} rowClassName="h-12" />
        ) : members.length === 0 && pending.length === 0 ? (
          <MembersEmptyState kind={kind} searching={term !== undefined} />
        ) : (
          <TableCard>
            <Table stack={false} className="table-fixed xl:min-w-[720px]">
              <colgroup>
                <col className="w-[46%]" />
                <col className="w-[16%]" />
                <col className="w-[20%] max-md:hidden" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <Tr className="hover:bg-transparent">
                  <Th>{t('columns.account')}</Th>
                  <Th>{t('columns.role')}</Th>
                  <Th className="max-md:hidden">{t('columns.joined')}</Th>
                  <Th alignment="end">{tCommon('actions')}</Th>
                </Tr>
              </thead>
              <tbody>
                {pending.map((invite) => (
                  <TeamInviteRow key={invite.id} invite={invite} onRevoke={setTarget} />
                ))}
                {members.map((member) => (
                  <TeamMemberRow
                    key={member.userId}
                    member={member}
                    teamId={teamId}
                    viewerRole={team?.role ?? 'member'}
                    self={member.userId === session?.user.id}
                    onRemove={member.agentId == null ? setRemoving : undefined}
                    onOpen={
                      member.agentId != null
                        ? () => router.push(teamSectionPath(teamId, 'ai-agents'))
                        : undefined
                    }
                  />
                ))}
              </tbody>
            </Table>
          </TableCard>
        )}

        {total > 0 && <ListPager paging={paging} total={total} />}
      </div>

      {inviting && team && (
        <TeamInviteDialog
          teamId={teamId}
          teamName={team.name}
          teamRole={team.role}
          onClose={() => setInviting(false)}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={t('members.removeTitle', { name: removing.name || removing.email })}
          confirmLabel={t('members.removeConfirm')}
          onConfirm={async () => {
            await removeMember.mutateAsync(removing.userId);
            setRemoving(null);
            toast.success(t('members.removed', { name: removing.name || removing.email }));
          }}
          onClose={() => setRemoving(null)}
        >
          <div className="text-sm text-muted-foreground">{t('members.removeDescription')}</div>
        </ConfirmDialog>
      )}

      {target && (
        <ConfirmDialog
          title={tInvite('revokeTitle', { email: target.email })}
          confirmLabel={tInvite('revokeConfirm')}
          onConfirm={async () => {
            await deleteInvite.mutateAsync(target.id);
            setTarget(null);
          }}
          onClose={() => setTarget(null)}
        >
          <div className="text-sm text-muted-foreground">{tInvite('revokeDescription')}</div>
        </ConfirmDialog>
      )}
    </SectionPageView>
  );
}
