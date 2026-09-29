'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { AgentLogin } from '@/lib/api/endpoints/accessLogins';
import {
  useAccessLoginsQuery,
  useCheckAgentLogin,
  useSignOutAgentLogin,
} from '@/services/accessLogins.service';
import { AgentLoginItem } from './AgentLoginItem';
import { SharedLoginItem } from './SharedLoginItem';
import { orderedAgentLogins, orderedSharedLogins } from './loginsView';

// "Anmeldungen": every login Helena's agents use, above the stored credentials of Zugänge.
// The model logins every Hermes agent shares (the owner sees them), then each Claude Code
// and Codex agent with the login its runtime works with. `?agent=<id>` (the agent page's
// "In Zugänge ansehen") marks that agent's row and scrolls to it.
export function AccessLoginsSection({
  teamId,
  canManage,
  onAddRuntimeLogin,
}: {
  teamId: number;
  canManage: boolean;
  onAddRuntimeLogin?: () => void;
}) {
  const t = useTranslations('credentials.logins');
  const query = useAccessLoginsQuery(teamId);
  const check = useCheckAgentLogin(teamId);
  const signOut = useSignOutAgentLogin(teamId);
  const [confirm, setConfirm] = useState<AgentLogin | null>(null);
  const focused = Number(useSearchParams().get('agent')) || null;
  const loaded = !!query.data;

  useEffect(() => {
    if (!focused || !loaded) return;
    document
      .getElementById(`login-agent-${focused}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focused, loaded]);

  if (!query.data) {
    return query.isError ? null : <ListSkeleton rows={2} rowClassName="h-14" />;
  }
  const shared = orderedSharedLogins(query.data.shared ?? []);
  const agents = orderedAgentLogins(query.data.agents);
  if (shared.length === 0 && agents.length === 0) return null;

  return (
    <section aria-labelledby="access-logins-title" className="space-y-2">
      <h2 id="access-logins-title" className="text-md font-medium">
        {t('title')}
      </h2>
      <ul className="divide-y overflow-hidden rounded-md border border-sidebar-border bg-card">
        {shared.map((login) => (
          <SharedLoginItem key={login.key} login={login} />
        ))}
        {agents.map((login) => (
          <AgentLoginItem
            key={login.agentId}
            login={login}
            canManage={canManage}
            highlighted={login.agentId === focused}
            checking={check.isPending && check.variables === login.agentId}
            onCheck={() => {
              if (!check.isPending) check.mutate(login.agentId);
            }}
            onSignOut={() => setConfirm(login)}
            onAddRuntimeLogin={onAddRuntimeLogin}
          />
        ))}
      </ul>
      {confirm && (
        <ConfirmDialog
          title={t('signOutTitle', { name: confirm.name })}
          confirmLabel={t('signOut')}
          onConfirm={async () => {
            await signOut.mutateAsync(confirm.agentId);
            setConfirm(null);
          }}
          onClose={() => setConfirm(null)}
        >
          <p className="text-sm text-muted-foreground">
            {t(`signOutMessage.${confirm.runtime}`, {
              name: confirm.name,
              account: confirm.account?.email ?? '',
            })}
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
