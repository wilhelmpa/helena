'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  useInstanceBrowserControlQuery,
  useTeamConnectionsQuery,
  useUpdateInstanceBrowserControl,
} from '@/features/browser-lab/services/browserTask.service';
import { credentialsPath } from '@/utils/paths';
import { useTeamsQuery } from '@/services/teams.service';

// "Jev / Laya (experimentell)" on the "Lokale KI" card: the instance default of the browser
// control hub/browser-task owns (Administrator → Agenten-Laufzeit → Browser-Steuerung;
// projects on "Wie in den Voreinstellungen" follow it, their own settings stay). On sets the
// default to the decision model with the connection chosen there, else the first one of the
// owner's team; off sets "Standard". Not part of the master switch, off by default. Without a
// decision-model connection in Zugänge the switch is off and links there. The setting, its
// routes and its queries are browser-task's (same cache as its settings page): nothing is
// stored here.

export default function JevToggle() {
  const t = useTranslations('localAi.jev');
  const teams = useTeamsQuery();
  const teamId =
    teams.data?.find((team) => team.role === 'owner')?.id ?? teams.data?.[0]?.id ?? null;
  const control = useInstanceBrowserControlQuery();
  const connections = useTeamConnectionsQuery(control.data ? teamId : null);
  const save = useUpdateInstanceBrowserControl();

  if (!control.data) return null;
  const current = control.data;
  const first = connections.data?.connections[0]?.id ?? null;
  const connection = current.credentialId ?? first;
  const on = current.mode === 'decision';

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1 @md:flex-row @md:items-center @md:gap-2">
        <span className="min-w-0 truncate @md:flex-1">{t('label')}</span>
        <span className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {t('experimental')}
          </Badge>
          {!on && connection === null && !connections.isLoading && (
            <Link href={credentialsPath()} className="text-xs underline underline-offset-2">
              {t('connect')}
            </Link>
          )}
        </span>
      </div>
      <Switch
        aria-label={t('label')}
        checked={on}
        disabled={save.isPending || (!on && connection === null)}
        onCheckedChange={(checked) =>
          save.mutate(
            checked
              ? { mode: 'decision', credentialId: connection, policy: current.policy }
              : { mode: 'standard' },
          )
        }
      />
    </div>
  );
}
