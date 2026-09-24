import Link from 'next/link';
import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BrowserControlPolicy } from '@/lib/api/endpoints/browserTask';
import { useTeamsQuery } from '@/services/teams.service';
import { accessPath } from '@/utils/paths';
import {
  useInstanceBrowserControlQuery,
  useTeamConnectionsQuery,
  useUpdateInstanceBrowserControl,
} from '../services/browserTask.service';
import { connectionLabel } from '../utils/lab';

const POLICIES: BrowserControlPolicy[] = ['auto', 'jev', 'laya'];

// Administrator → Agenten-Laufzeit, "Browser-Steuerung (Voreinstellung)": what a project that
// keeps "Wie in den Voreinstellungen" gets (docs/helena-decisions/browser-task.md §3.3). A
// connection of one team applies to that team's projects.
export function InstanceBrowserControlSection() {
  const t = useTranslations('browserLab.control');
  const control = useInstanceBrowserControlQuery();
  const update = useUpdateInstanceBrowserControl();
  const teams = useTeamsQuery().data ?? [];
  const [chosenTeam, setChosenTeam] = useState<number | null>(null);
  const teamId = chosenTeam ?? teams[0]?.id ?? null;
  const connections = useTeamConnectionsQuery(teamId).data?.connections ?? [];

  if (control.isPending || !control.data) return <ListSkeleton rows={1} rowClassName="h-12" />;
  const setting = control.data;

  return (
    <SettingsSection title={t('defaultTitle')} description={t('defaultHint')}>
      <SettingsCard className="divide-y divide-border/60">
        <SettingsRow
          title={t('mode')}
          description={t('modeHint')}
          control={
            <Select
              value={setting.mode}
              onValueChange={(mode) => {
                if (mode === 'decision' && connections.length === 0) return;
                update.mutate({
                  mode: mode as 'standard' | 'decision',
                  ...(mode === 'decision' && setting.credentialId === null
                    ? { credentialId: connections[0]!.id }
                    : {}),
                });
              }}
            >
              <SelectTrigger className="w-60" aria-label={t('mode')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">{t('modes.standard')}</SelectItem>
                <SelectItem value="decision" disabled={connections.length === 0}>
                  {t('modes.decision')}
                </SelectItem>
              </SelectContent>
            </Select>
          }
        />
        {teams.length > 1 && (
          <SettingsRow
            title={t('team')}
            description={t('teamHint')}
            control={
              <Select
                value={teamId === null ? undefined : String(teamId)}
                onValueChange={(id) => setChosenTeam(Number(id))}
              >
                <SelectTrigger className="w-60" aria-label={t('team')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={String(team.id)}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        )}
        {connections.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm text-muted-foreground">{t('noConnection')}</p>
            <Button asChild variant="outline" size="sm">
              <Link href={accessPath('credentials')}>
                <KeyRound />
                {t('toAccess')}
              </Link>
            </Button>
          </div>
        ) : (
          setting.mode === 'decision' && (
            <>
              <SettingsRow
                title={t('connection')}
                description={t('connectionHint')}
                control={
                  <Select
                    value={setting.credentialId === null ? undefined : String(setting.credentialId)}
                    onValueChange={(id) => update.mutate({ credentialId: Number(id) })}
                  >
                    <SelectTrigger className="w-60" aria-label={t('connection')}>
                      <SelectValue placeholder={t('chooseConnection')} />
                    </SelectTrigger>
                    <SelectContent>
                      {connections.map((connection) => (
                        <SelectItem key={connection.id} value={String(connection.id)}>
                          {connectionLabel(connection)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
              <SettingsRow
                title={t('policy')}
                description={t('policyHint')}
                control={
                  <Select
                    value={setting.policy}
                    onValueChange={(policy) =>
                      update.mutate({ policy: policy as BrowserControlPolicy })
                    }
                  >
                    <SelectTrigger className="w-60" aria-label={t('policy')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {POLICIES.map((policy) => (
                        <SelectItem key={policy} value={policy}>
                          {t(`policies.${policy}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            </>
          )
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
