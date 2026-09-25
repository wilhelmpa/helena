'use client';

import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import StatusBadge from '@/components/common/page/StatusBadge';
import { Button } from '@/components/ui/button';
import { formatDurationShort } from '@/utils/dates';
import { accessLoginsPath } from '@/utils/paths';
import { planLabel } from '@/features/access/logins/loginsView';
import {
  useRewriteRuntimeProfile,
  useRuntimeSyncQuery,
} from '../../services/agentRuntimeSync.service';
import { driftServer, profileServers, syncStatus } from '../../utils/agentProfileSync';
import AgentRuntimeIssues from './AgentRuntimeIssues';

// Whether the agent's runtime runs exactly on its settings here: its runner applied them,
// read the runtime's profile back and found nothing that differs ("Profil synchron"), or
// names what differs. "Neu schreiben" has the runner write the whole profile again. Below,
// what the runtime falls back to when the agent names no model ("Agent default") and the
// MCP servers it starts.
export default function AgentProfileSync({
  teamId,
  agentId,
  canEdit,
}: {
  teamId: number;
  agentId: number;
  canEdit: boolean;
}) {
  const t = useTranslations('teams.agents.profileSync');
  const { data: sync } = useRuntimeSyncQuery(teamId, agentId);
  const rewrite = useRewriteRuntimeProfile(teamId, agentId);
  if (!sync) return null;

  const drift = sync.state === 'drift' ? (sync.profile?.drift ?? []) : [];
  // A Claude Code or Codex agent's login, in full in Zugänge ("Anmeldungen"); a missing one
  // is an issue below, with the same link.
  const cliRuntime = sync.adapter === 'claude' || sync.adapter === 'codex';
  const notSignedIn = (sync.issues ?? []).some((issue) => issue.code === 'not-signed-in');
  const account = sync.account?.signedIn ? sync.account : null;
  const accountName = account
    ? [account.email, planLabel(account.plan)].filter(Boolean).join(' · ')
    : '';
  const defaults = sync.profile?.defaults ?? null;
  const servers = profileServers(sync);
  const checkedAt = sync.profile?.checkedAt ?? null;

  return (
    <div className="space-y-2 rounded-md border bg-card p-3">
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
        <StatusBadge status={syncStatus(sync.state)} className="text-sm">
          {t(`state.${sync.state}`)}
        </StatusBadge>
        {sync.version && sync.state !== 'offline' && (
          <span dir="ltr" className="text-xs text-muted-foreground">
            {t('version', { version: sync.version })}
          </span>
        )}
        {sync.sandbox && sync.state !== 'offline' && (
          <span className="text-xs text-muted-foreground">
            {t('sandbox', { mode: t(`sandboxModes.${sync.sandbox}`) })}
          </span>
        )}
        {checkedAt && sync.state !== 'offline' && (
          <span className="text-xs text-muted-foreground">
            {t('checked', { time: formatDurationShort(checkedAt) })}
          </span>
        )}
        {canEdit && sync.state !== 'offline' && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ms-auto"
            disabled={rewrite.isPending || sync.rewritePending}
            onClick={() => rewrite.mutate()}
          >
            <RefreshCw className={sync.rewritePending ? 'animate-spin' : undefined} />
            {sync.rewritePending ? t('rewriting') : t('rewrite')}
          </Button>
        )}
      </div>
      {sync.state === 'degraded' && sync.detail && (sync.issues ?? []).length === 0 && (
        <p className="text-xs text-destructive">{sync.detail}</p>
      )}
      {sync.state !== 'offline' && (
        <AgentRuntimeIssues agentId={agentId} adapter={sync.adapter} issues={sync.issues ?? []} />
      )}
      {cliRuntime && !notSignedIn && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>
            {accountName ? t('login.signedInAs', { account: accountName }) : t('login.title')}
          </span>
          <Link
            href={accessLoginsPath(agentId)}
            className="text-foreground underline-offset-2 hover:underline"
          >
            {t('login.view')}
          </Link>
        </p>
      )}
      {drift.length > 0 && (
        <ul className="space-y-1">
          {drift.map((entry) => {
            const server = driftServer(entry);
            return (
              <li key={`${entry.key}:${entry.code}`} className="text-sm">
                <span>{t(`drift.${entry.code}`, { server: server ?? '', key: entry.key })}</span>
                {entry.detail && (
                  <span dir="ltr" className="ms-1 font-mono text-xs text-muted-foreground">
                    ({entry.detail})
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {defaults && (defaults.model || defaults.reasoning) && (
        <p className="text-xs text-muted-foreground">
          {t('defaults', {
            model: defaults.model ?? '–',
            provider: defaults.provider ?? '–',
            reasoning: defaults.reasoning ?? '–',
          })}
        </p>
      )}
      {(servers.managed.length > 0 || servers.turnedOff.length > 0) && (
        <p className="text-xs text-muted-foreground">
          {t('servers', { servers: servers.managed.join(', ') || '–' })}
          {servers.turnedOff.length > 0 && (
            <> · {t('serversOff', { servers: servers.turnedOff.join(', ') })}</>
          )}
        </p>
      )}
    </div>
  );
}
