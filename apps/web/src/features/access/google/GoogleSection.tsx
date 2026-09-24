'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { EmptyState } from '@/components/common/page/EmptyState';
import SectionPageView from '@/components/common/page/SectionPageView';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { GoogleAccount, GoogleClient } from '@/lib/api/endpoints/access';
import {
  useAdoptGogAccount,
  useCheckGoogleAccount,
  useDeleteGoogleAccount,
  useDeleteGoogleClient,
  useGogStatusQuery,
  useGoogleQuery,
} from '@/services/access.service';
import { useTeamQuery } from '@/services/teams.service';
import { accessPath } from '@/utils/paths';
import { AccessAuditDialog } from '../AccessAuditDialog';
import { GrantsDialog } from '../GrantsDialog';
import { GoogleAccountRow, type GoogleRowAction } from './GoogleAccountRow';
import { ImportClientDialog } from './ImportClientDialog';
import { ServicesDialog } from './ServicesDialog';
import { SignInDialog, type SignInMode } from './SignInDialog';

type Open =
  | { dialog: 'import' }
  | { dialog: 'signIn'; mode: SignInMode }
  | { dialog: 'services' | 'grants' | 'audit' | 'remove'; account: GoogleAccount }
  | { dialog: 'deleteClient'; client: GoogleClient };

// The team's Google accounts: each signed in once (Helena keeps the token, or gog does),
// its services switched on or off, its health, who may use it, and its mailbox.
export function GoogleSection({ teamId, leading }: { teamId: number; leading: ReactNode }) {
  const t = useTranslations('access.google');
  const tCommon = useTranslations('common');
  const tServices = useTranslations('access.google.services');
  const { data: team } = useTeamQuery(teamId);
  const canManage = team?.role === 'owner' || team?.role === 'manager';
  const google = useGoogleQuery(teamId);
  const gog = useGogStatusQuery(teamId, canManage && (google.data?.gogAvailable ?? false));
  const check = useCheckGoogleAccount(teamId);
  const remove = useDeleteGoogleAccount(teamId);
  const deleteClient = useDeleteGoogleClient(teamId);
  const adopt = useAdoptGogAccount(teamId);
  const [open, setOpen] = useState<Open | null>(null);
  const [fromGog, setFromGog] = useState(false);
  const close = () => setOpen(null);
  const router = useRouter();
  const params = useSearchParams();
  const announced = useRef(false);

  // Google's return to Helena's callback lands here with the outcome.
  useEffect(() => {
    if (announced.current) return;
    const error = params.get('error');
    const connected = params.get('connected');
    if (!error && !connected) return;
    announced.current = true;
    if (error) toast.error(error);
    router.replace(accessPath('google'));
  }, [params, router]);

  function onAction(account: GoogleAccount, action: GoogleRowAction) {
    if (action === 'check') {
      check.mutate(account.id, {
        onSuccess: (checked) => toast.success(t('checked', { email: checked.email })),
      });
    } else if (action === 'signIn') setOpen({ dialog: 'signIn', mode: { kind: 'again', account } });
    else if (action === 'move') setOpen({ dialog: 'signIn', mode: { kind: 'move', account } });
    else {
      setFromGog(false);
      setOpen({ dialog: action, account });
    }
  }

  const data = google.data;
  const services = (data?.accounts[0]?.services ?? []).map((service) => ({
    id: service.id,
    label: tServices(service.id),
  }));

  return (
    <SectionPageView title={t('connect')} description="" wide>
      <PageToolbar>
        {leading}
        <PageToolbarSpacer />
        {canManage && (
          <PageActions
            actions={[
              {
                id: 'import',
                label: t('importClient'),
                icon: FileUp,
                onClick: () => setOpen({ dialog: 'import' }),
              },
            ]}
            primary={{
              id: 'connect',
              label: t('connect'),
              icon: Plus,
              onClick: () => setOpen({ dialog: 'signIn', mode: { kind: 'new' } }),
            }}
          />
        )}
      </PageToolbar>
      {!data ? (
        <ListSkeleton rows={3} rowClassName="h-16" />
      ) : (
        <div className="flex flex-col gap-6">
          {data.accounts.length === 0 ? (
            <EmptyState title={t('empty')} description={t('emptyHint')}>
              {canManage && data.clients.length === 0 && (
                <Button size="sm" variant="outline" onClick={() => setOpen({ dialog: 'import' })}>
                  <FileUp />
                  {t('importClient')}
                </Button>
              )}
            </EmptyState>
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border border-sidebar-border bg-card">
              {data.accounts.map((account) => (
                <GoogleAccountRow
                  key={account.id}
                  account={account}
                  canManage={canManage}
                  busy={check.isPending && check.variables === account.id}
                  onAction={(action) => onAction(account, action)}
                />
              ))}
            </ul>
          )}

          {canManage && (gog.data?.unlisted.length ?? 0) > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-md font-medium">{t('inGog')}</h2>
              <p className="text-xs text-muted-foreground">{t('inGogHint')}</p>
              <ul className="divide-y overflow-hidden rounded-lg border border-sidebar-border bg-card">
                {gog.data!.unlisted.map((entry) => (
                  <li key={entry.email} className="flex items-center gap-3 px-4 py-2.5">
                    <span dir="ltr" className="min-w-0 flex-1 truncate text-sm">
                      {entry.email}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={adopt.isPending}
                      onClick={() =>
                        adopt.mutate(
                          { email: entry.email },
                          { onSuccess: () => toast.success(t('adopted', { email: entry.email })) },
                        )
                      }
                    >
                      {t('adopt')}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.clients.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-md font-medium">{t('clients')}</h2>
              <ul className="divide-y overflow-hidden rounded-lg border border-sidebar-border bg-card">
                {data.clients.map((client) => (
                  <li key={client.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{client.label}</p>
                      <p dir="ltr" className="truncate font-mono text-xs text-muted-foreground">
                        {client.clientId}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t(`clientType.${client.type}`)} ·{' '}
                      {t('clientAccounts', { count: client.accounts })}
                    </span>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        aria-label={t('deleteClient')}
                        title={t('deleteClient')}
                        disabled={client.accounts > 0}
                        onClick={() => setOpen({ dialog: 'deleteClient', client })}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {open?.dialog === 'import' && (
        <ImportClientDialog
          teamId={teamId}
          gogAvailable={data?.gogAvailable ?? false}
          onClose={close}
        />
      )}
      {open?.dialog === 'signIn' && data && (
        <SignInDialog
          teamId={teamId}
          mode={open.mode}
          clients={data.clients}
          gogAvailable={data.gogAvailable}
          onClose={close}
        />
      )}
      {open?.dialog === 'services' && (
        <ServicesDialog teamId={teamId} account={open.account} onClose={close} />
      )}
      {open?.dialog === 'grants' && (
        <GrantsDialog
          teamId={teamId}
          target={{
            id: open.account.id,
            label: open.account.email,
            projectId: open.account.projectId,
            grants: open.account.grants,
          }}
          services={services}
          onClose={close}
        />
      )}
      {open?.dialog === 'audit' && (
        <AccessAuditDialog
          teamId={teamId}
          credentialId={open.account.id}
          name={open.account.email}
          onClose={close}
        />
      )}
      {open?.dialog === 'remove' && (
        <ConfirmDialog
          title={t('remove')}
          confirmLabel={t('remove')}
          onConfirm={async () => {
            await remove.mutateAsync({ id: open.account.id, fromGog });
            close();
          }}
          onClose={close}
        >
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>{t('removeMessage', { email: open.account.email })}</p>
            {open.account.engine === 'gog' && (
              <label className="flex cursor-pointer items-center gap-2 text-foreground">
                <Checkbox checked={fromGog} onCheckedChange={(on) => setFromGog(on === true)} />
                {t('removeFromGog')}
              </label>
            )}
          </div>
        </ConfirmDialog>
      )}
      {open?.dialog === 'deleteClient' && (
        <ConfirmDialog
          title={t('deleteClient')}
          confirmLabel={tCommon('delete')}
          onConfirm={async () => {
            await deleteClient.mutateAsync(open.client.id);
            close();
          }}
          onClose={close}
        >
          <p className="text-sm text-muted-foreground">
            {t('deleteClientMessage', { name: open.client.label })}
          </p>
        </ConfirmDialog>
      )}
    </SectionPageView>
  );
}
