'use client';

import { useState, type ReactNode } from 'react';
import { Bot, FolderOpen, MailWarning, Shield, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { formatDate, formatDateTime } from '@/utils/dates';
import Avatar from '@/components/common/Avatar';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { usePermissionCatalogQuery } from '@/services/roles.service';
import { useDeleteInstanceUser, useInstanceUserQuery } from '../../services/god.service';
import { useProviderList } from '../../hooks/useProviderList';
import GodUserProjectCard from './GodUserProjectCard';
import GodUserVerifyButton from './GodUserVerifyButton';

import { Box, Button, Overlay, Stack, Inline, Text, Card } from '@/design-system';

// One fact in the account grid: a quiet label with the value under it. Reading down
// a column beats a row of label/value pairs when the values differ in length.
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap={1}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{children}</div>
    </Stack>
  );
}

// One account in the one overlay on the right (the same surface the role editor uses): the
// account facts and every project it can reach, each with the permissions its membership
// resolves to. Esc closes it (the confirmation first).
export default function GodUserDetailPanel({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const t = useTranslations('god.userPanel');
  const tCommon = useTranslations('common');
  const providerList = useProviderList();
  const userQuery = useInstanceUserQuery(userId);
  const catalogQuery = usePermissionCatalogQuery();
  const deleteUser = useDeleteInstanceUser();
  const [confirming, setConfirming] = useState(false);
  const [withProjects, setWithProjects] = useState(false);
  const user = userQuery.data;

  // Projects this user owns alone. Deleting the account leaves them without anyone
  // who can manage them, so the API refuses unless they are deleted along with it.
  const soleOwned = (user?.projects ?? []).filter((p) => p.role === 'owner' && p.ownerCount === 1);

  // An instance owner keeps god mode reachable, and an agent's bot user belongs to
  // its AI Agent config. The API refuses both; the button is hidden for them too.
  const removable = user ? user.role !== 'god' && !user.isAgent : false;

  async function confirmDelete() {
    await deleteUser.mutateAsync({ userId, withProjects });
    setConfirming(false);
    toast.success(t(withProjects ? 'deletedWithProjects' : 'deleted'));
    onClose();
  }

  const name = user ? user.name || user.email : tCommon('loading');
  return (
    <>
      <Overlay
        label={name}
        tabs={[{ id: 'user', label: name }]}
        onClose={onClose}
        escape={!confirming}
        className="ds-god-overlay"
        width="wide"
      >
        <div className="ds-overlay-form">
          <Stack gap={5}>
            {user && (
              <Inline gap={3} align="start" className="flex min-w-0 items-start">
                <Avatar
                  name={user.name || user.email || '?'}
                  image={user.image}
                  className="size-11 shrink-0 text-sm"
                />
                <Stack gap={2} className="min-w-0">
                  <Text as="p" size="xs" tone="muted" className="truncate">
                    {user.email}
                  </Text>
                  <Inline gap={2} wrap className="flex flex-wrap items-center">
                    {user.role === 'god' ? (
                      <Badge className="gap-1">
                        <Shield className="size-3" />
                        {t('instanceOwner')}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="px-1.5 py-0 text-xs font-medium">
                        {t('user')}
                      </Badge>
                    )}
                    {user.isAgent && (
                      <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-xs font-medium">
                        <Bot className="size-3" />
                        {t('aiAgent')}
                      </Badge>
                    )}
                    {user.emailVerified && (
                      <Badge variant="outline" className="px-1.5 py-0 text-xs font-medium">
                        {t('emailVerified')}
                      </Badge>
                    )}
                  </Inline>
                </Stack>
              </Inline>
            )}
            {!user ? (
              <ListSkeleton rows={5} rowClassName="h-12" />
            ) : (
              <>
                {!user.emailVerified && (
                  <Inline
                    gap={3}
                    align="start"
                    pad={4}
                    className="flex items-start rounded-md border border-sidebar-border bg-card"
                  >
                    <MailWarning className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <Stack gap={1} className="min-w-0 flex-1">
                      <Text as="p" size="sm" className="font-medium">
                        {t('unconfirmedTitle')}
                      </Text>
                      <Text as="p" size="xs" tone="muted">
                        {t('unconfirmedHint')}
                      </Text>
                    </Stack>
                    <GodUserVerifyButton userId={user.id} />
                  </Inline>
                )}

                <section className="grid grid-cols-2 gap-x-6 gap-y-5">
                  <Fact label={t('signInMethods')}>
                    {user.providers.length ? (
                      providerList(user.providers)
                    ) : (
                      <Text as="span" tone="muted">
                        {t('noProviders')}
                      </Text>
                    )}
                  </Fact>
                  <Fact label={t('projects')}>
                    {user.projectCount === 0 ? (
                      <Text as="span" tone="muted">
                        {t('noProjects')}
                      </Text>
                    ) : (
                      user.projectCount
                    )}
                  </Fact>
                  <Fact label={t('registered')}>{formatDate(user.createdAt)}</Fact>
                  <Fact label={t('lastSeen')}>
                    {user.lastSeenAt ? (
                      formatDateTime(user.lastSeenAt)
                    ) : (
                      <Text as="span" tone="muted">
                        {t('neverSignedIn')}
                      </Text>
                    )}
                  </Fact>
                </section>

                <Stack as="section" gap={3}>
                  <Inline gap={2} align="baseline" className="flex items-baseline">
                    <h3 className="text-sm font-medium">{t('projectAccess')}</h3>
                    {user.projects.length > 0 && (
                      <Text as="span" size="xs" tone="muted">
                        {user.projects.length}
                      </Text>
                    )}
                  </Inline>
                  {user.projects.length === 0 ? (
                    <Stack
                      gap={2}
                      padX={4}
                      padY={5}
                      className="flex flex-col items-center rounded-md border border-dashed border-sidebar-border text-center"
                    >
                      <FolderOpen className="size-5 text-muted-foreground" />
                      <Text as="p" size="sm" className="font-medium">
                        {t('noAccessTitle')}
                      </Text>
                      <Text as="p" size="xs" tone="muted" className="max-w-[36ch]">
                        {t('noAccessHint')}
                      </Text>
                    </Stack>
                  ) : (
                    <Stack gap={2}>
                      {user.projects.map((p) => (
                        <GodUserProjectCard
                          key={p.projectId}
                          project={p}
                          catalog={catalogQuery.data}
                        />
                      ))}
                    </Stack>
                  )}
                </Stack>
              </>
            )}
          </Stack>

          {removable && (
            <div className="ds-overlay-footer">
              <Text as="p" size="xs" tone="muted" className="ds-overlay-footer-start">
                {t('deleteHint')}
              </Text>
              <Button
                variant="danger"
                icon={<Trash2 />}
                onClick={() => {
                  setWithProjects(false);
                  setConfirming(true);
                }}
              >
                {tCommon('delete')}
              </Button>
            </div>
          )}
        </div>
      </Overlay>

      {confirming && user && (
        <ConfirmDialog
          title={t('deleteTitle')}
          confirmLabel={
            withProjects
              ? t('deleteConfirmWithProjects', { count: soleOwned.length })
              : t('deleteConfirm')
          }
          confirmDisabled={soleOwned.length > 0 && !withProjects}
          onConfirm={confirmDelete}
          onClose={() => setConfirming(false)}
        >
          <Stack gap={4}>
            <Text as="p" size="sm" tone="muted">
              {t.rich('deleteMessage', {
                name: user.name || user.email,
                strong: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </Text>

            {soleOwned.length > 0 && (
              <Card gap={4}>
                <Inline gap={3} align="start" className="flex items-start">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <Stack gap={2} className="min-w-0">
                    <Text as="p" size="sm" className="font-medium">
                      {t('soleOwnerTitle', { count: soleOwned.length })}
                    </Text>
                    <Inline gap={1} align="stretch" wrap className="flex flex-wrap">
                      {soleOwned.map((p) => (
                        <Box
                          as="span"
                          padX={2}
                          padY={1}
                          key={p.projectId}
                          className="rounded-sm bg-secondary text-xs font-medium text-secondary-foreground"
                        >
                          {p.projectKey}
                        </Box>
                      ))}
                    </Inline>
                    <Text as="p" size="xs" tone="muted">
                      {t('soleOwnerHint', { count: soleOwned.length })}
                    </Text>
                  </Stack>
                </Inline>

                <Inline
                  as="label"
                  gap={3}
                  align="start"
                  pad={3}
                  className="flex cursor-pointer items-start rounded-md bg-background/60 transition-colors hover:bg-background"
                >
                  <Checkbox
                    checked={withProjects}
                    onCheckedChange={(v) => setWithProjects(v === true)}
                    className="mt-0.5"
                  />
                  <Stack as="span" gap={1}>
                    <Text as="span" size="sm" className="block">
                      {t('deleteWithProjects', { count: soleOwned.length })}
                    </Text>
                    <Text as="span" size="xs" tone="muted" className="block">
                      {t(withProjects ? 'deleteWithProjectsOn' : 'deleteWithProjectsOff')}
                    </Text>
                  </Stack>
                </Inline>
              </Card>
            )}
          </Stack>
        </ConfirmDialog>
      )}
    </>
  );
}
