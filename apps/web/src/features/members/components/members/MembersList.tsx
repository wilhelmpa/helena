'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { MemberKind, MemberRow as Member } from '@/lib/api/endpoints/members';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import MembersEmptyState from '@/components/common/page/MembersEmptyState';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  PageActions,
  PageSearch,
  PageTabs,
  PageToolbar,
  PageToolbarSpacer,
  type PageAction,
} from '@/components/layout/PageToolbar';
import { useMembersQuery, useRemoveMember } from '@/services/members.service';
import { useTeamRoleOptionsQuery } from '@/services/roles.service';
import { useSearchTerm } from '@/hooks/useSearchTerm';
import { usePermissions } from '@/hooks/usePermissions';
import { useSession } from '@/lib/auth-client';
import ListPager from '@/components/common/ListPager';
import { usePaging } from '@/hooks/usePaging';
import MemberRow from './MemberRow';
import { Stack } from '@/design-system';

// The project's members, newest membership first, a page at a time. People and AI
// agents share one list and are told apart by the tabs, so neither is pushed off the
// first page by the other; the search runs on the server, within the open tab. The
// last owner is protected — the API rejects removing them and the row's action is
// disabled too. The tabs, the search and the page's primary action (`primary`, add a
// member) are the page's one header row.
export default function MembersList({
  projectKey,
  teamId,
  primary,
}: {
  projectKey: string;
  teamId: number;
  primary?: Omit<PageAction, 'menuOnly'>;
}) {
  const t = useTranslations('members');
  const [kind, setKind] = useState<MemberKind>('all');
  const { search, setSearch, term } = useSearchTerm();
  const paging = usePaging();
  const { can, isAdmin } = usePermissions();
  const { data: session } = useSession();
  const currentUserId = session?.user.id ?? null;
  const removeMember = useRemoveMember(projectKey);
  // Roles feed the per-member role select, so the list is only fetched for a reader
  // who gets one.
  const canEdit = can('members_manage', 'edit') || isAdmin;
  const rolesQuery = useTeamRoleOptionsQuery(canEdit ? teamId : null);
  const router = useRouter();
  const [target, setTarget] = useState<Member | null>(null);

  const membersQuery = useMembersQuery(projectKey, { search: term, kind, ...paging.params });

  const members = membersQuery.data?.items ?? [];
  const roles = rolesQuery.data ?? [];
  const total = membersQuery.data?.total ?? 0;
  const ownerCount = membersQuery.data?.ownerCount ?? 0;

  function onKindChange(next: string) {
    setKind(next as MemberKind);
    paging.reset();
  }

  function onSearchChange(next: string) {
    setSearch(next);
    paging.reset();
  }

  // The placeholder names what the open tab holds, so the search says what it covers.
  const searchPlaceholder = {
    all: t('search.all'),
    human: t('search.people'),
    agent: t('search.agents'),
  }[kind];

  const targetIsSelf = target?.userId === currentUserId;
  const targetName = target ? target.name || target.email : '';

  async function confirmRemove() {
    if (!target) return;
    await removeMember.mutateAsync(target.userId);
    setTarget(null);
    // Leaving the project revokes your own access; return to the app root, which
    // reopens a project you still belong to.
    if (targetIsSelf) {
      router.push('/');
      router.refresh();
    }
  }

  const toolbar = (
    <PageToolbar>
      <PageTabs
        label={t('title')}
        value={kind}
        onChange={onKindChange}
        items={[
          { value: 'all', label: t('tabs.all') },
          { value: 'human', label: t('tabs.people') },
          { value: 'agent', label: t('tabs.agents') },
        ]}
      />
      <PageToolbarSpacer />
      <PageSearch value={search} onChange={onSearchChange} placeholder={searchPlaceholder} />
      <PageActions primary={primary} />
    </PageToolbar>
  );

  if (membersQuery.isPending)
    return (
      <>
        {toolbar}
        <ListSkeleton className="mb-6" rowClassName="h-14" />
      </>
    );

  return (
    <Stack gap={4} marginBottom={5} className="min-h-0 flex-1">
      {toolbar}
      {members.length === 0 ? (
        <MembersEmptyState kind={kind} searching={term !== undefined} />
      ) : (
        <div className="overflow-hidden rounded-md border bg-card">
          <Table className="table-fixed md:min-w-[720px]">
            <colgroup>
              <col className="md:w-[36%]" />
              <col className="w-32 md:w-[17%]" />
              <col className="hidden md:table-column md:w-[17%]" />
              <col className="hidden md:table-column md:w-[13%]" />
              <col className="w-14 md:w-[17%]" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-3 text-xs font-normal text-muted-foreground">
                  {t('columns.member')}
                </TableHead>
                <TableHead className="px-3 text-xs font-normal text-muted-foreground">
                  {t('columns.role')}
                </TableHead>
                <TableHead className="hidden px-3 text-xs font-normal text-muted-foreground md:table-cell">
                  {t('columns.timezone')}
                </TableHead>
                <TableHead className="hidden px-3 text-xs font-normal text-muted-foreground md:table-cell">
                  {t('columns.joined')}
                </TableHead>
                <TableHead className="px-3 text-end text-xs font-normal text-muted-foreground">
                  <span className="sr-only md:not-sr-only">{t('columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <MemberRow
                  key={m.userId}
                  projectKey={projectKey}
                  member={m}
                  roles={roles}
                  isLastOwner={m.role === 'owner' && ownerCount === 1}
                  onRemove={setTarget}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 && <ListPager paging={paging} total={total} />}

      {target && (
        <ConfirmDialog
          title={targetIsSelf ? t('leaveTitle') : t('revokeTitle', { name: targetName })}
          confirmLabel={targetIsSelf ? t('leaveProject') : t('revokeAccess')}
          onConfirm={confirmRemove}
          onClose={() => setTarget(null)}
        >
          <div className="text-sm text-muted-foreground">
            {targetIsSelf ? t('leaveDescription') : t('revokeDescription', { name: targetName })}
          </div>
        </ConfirmDialog>
      )}
    </Stack>
  );
}
