'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ApiError, request } from '@/lib/api/core/client';
import { credentialsPath } from '@/utils/paths';
import { useTeamsQuery } from '@/services/teams.service';

// "Jev / Laya (experimentell)" on the "Lokale KI" card: the instance default of the browser
// control hub/browser-task owns (Administrator → Agenten-Laufzeit → Browser-Steuerung;
// projects on "Wie in den Voreinstellungen" follow it, their own settings stay). On sets the
// default to the decision model with the connection chosen there, else the first one of the
// owner's team; off sets "Standard". Not part of the master switch, off by default. Without a
// decision-model connection in Zugänge the switch is off and links there. The setting and its
// routes are browser-task's: nothing is stored here.

interface InstanceBrowserControl {
  mode: 'standard' | 'decision';
  credentialId: number | null;
  policy: 'auto' | 'jev' | 'laya';
  minConfidence: number | null;
}

const key = ['localAi', 'browserControl'] as const;

async function readControl(): Promise<InstanceBrowserControl | null> {
  try {
    return await request<InstanceBrowserControl>('/god/browser-control');
  } catch (error) {
    // Browser 2.0 is not installed on this Helena.
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export default function JevToggle() {
  const t = useTranslations('localAi.jev');
  const qc = useQueryClient();
  const teams = useTeamsQuery();
  const teamId = teams.data?.find((team) => team.role === 'owner')?.id ?? teams.data?.[0]?.id;
  const control = useQuery({ queryKey: key, queryFn: readControl, retry: false });
  const connections = useQuery({
    queryKey: [...key, 'connections', teamId],
    queryFn: () =>
      request<{ connections: { id: number; label: string }[] }>(
        `/teams/${teamId}/browser-control/connections`,
      ),
    enabled: teamId !== undefined && control.data != null,
    retry: false,
  });
  const save = useMutation({
    mutationFn: (patch: Partial<InstanceBrowserControl>) =>
      request<InstanceBrowserControl>('/god/browser-control', {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),
    onSuccess: (value) => qc.setQueryData(key, value),
    onError: (error: Error) => toast.error(error.message),
  });

  if (control.isLoading || control.data === null || control.isError) return null;
  const current = control.data!;
  const first = connections.data?.connections[0]?.id ?? null;
  const connection = current.credentialId ?? first;
  const on = current.mode === 'decision';

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <span className="min-w-0 flex-1 truncate">{t('label')}</span>
      <Badge variant="outline" className="text-xs">
        {t('experimental')}
      </Badge>
      {!on && connection === null && !connections.isLoading && (
        <Link href={credentialsPath()} className="text-xs underline underline-offset-2">
          {t('connect')}
        </Link>
      )}
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
