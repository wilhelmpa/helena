'use client';

import Link from 'next/link';
import { Cpu, ExternalLink, LoaderCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import StatusBadge, { type Status } from '@/components/common/page/StatusBadge';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { LocalAiStatus, LocalAiUnit } from '@/lib/api/endpoints/localAi';
import { cn } from '@/lib/utils';
import {
  useLocalAiSettings,
  useLocalAiStatus,
  useUpdateLocalAiPolicy,
} from '../services/localAi.service';
import {
  UNITS,
  classToggle,
  gib,
  localShare,
  percent,
  resolveLabel,
  shortModel,
  unitState,
} from '../utils/localAi';
import JevToggle from './JevToggle';

export const LOCAL_AI_SETTINGS_HREF = '/god/local-ai';

// "Lokale KI" on Start (owner only): the master switch, which units and kinds of work use it,
// and what runs right now. Self-contained (its own queries), so the dashboard's widget
// registry (hub/dashboard) mounts it as it is; the detailed settings are one link away.
// Off, Helena works exactly as without local AI: every agent on its configured model.
export default function LocalAiCard({ className }: { className?: string }) {
  const t = useTranslations('localAi');
  const locale = useLocale();
  const status = useLocalAiStatus();
  const settings = useLocalAiSettings();
  const update = useUpdateLocalAiPolicy();

  const onError = (error: Error) => toast.error(error.message);
  const data = status.data;
  const serverDown = data?.servers.some((server) => server.enabled && !server.reachable) ?? false;
  const noServer = data ? data.servers.length === 0 : false;
  const badge: { status: Status; label: string } = !data
    ? { status: 'idle', label: t('card.loading') }
    : noServer
      ? { status: 'idle', label: t('card.noServer') }
      : !data.enabled
        ? { status: 'idle', label: t('card.off') }
        : serverDown
          ? { status: 'danger', label: t('card.serverDown') }
          : { status: 'success', label: t('card.on') };
  const share = data ? localShare(data.usage) : null;
  const classes = (settings.data?.classes ?? []).filter((entry) => !entry.experimental);

  return (
    <section
      className={cn(
        '@container flex flex-col gap-3 rounded-lg border bg-card p-4 text-sm',
        className,
      )}
      aria-labelledby="local-ai-card-title"
    >
      <header className="flex items-center gap-2">
        <Cpu className="size-4 text-muted-foreground" aria-hidden />
        <h2 id="local-ai-card-title" className="text-md font-semibold">
          {t('title')}
        </h2>
        <StatusBadge status={badge.status} className="text-xs">
          {badge.label}
        </StatusBadge>
        <div className="ms-auto flex items-center gap-2">
          {update.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          <Switch
            aria-label={t('card.master')}
            checked={data?.enabled ?? false}
            disabled={!data || noServer || update.isPending}
            onCheckedChange={(enabled) => update.mutate({ enabled }, { onError })}
          />
        </div>
      </header>

      {data && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {UNITS.map((unit) => (
            <UnitTile
              key={unit}
              unit={unit}
              status={data}
              pending={update.isPending}
              onToggle={(allowed) => update.mutate({ units: { [unit]: allowed } }, { onError })}
            />
          ))}
        </div>
      )}

      {classes.length > 0 && (
        <ul className="divide-y rounded-md border" aria-label={t('card.classes')}>
          {classes.map((entry) => {
            const toggle = classToggle(entry);
            return (
              <li key={entry.id} className="flex items-center gap-2 px-3 py-2">
                {/* A narrow card (a phone, a small dashboard tile) puts the state under the
                    name instead of cutting the name off. */}
                <div className="flex min-w-0 flex-1 flex-col @md:flex-row @md:items-center @md:gap-2">
                  <span className="min-w-0 truncate @md:flex-1">
                    {resolveLabel(entry.label, locale, (key) => t(key as never))}
                  </span>
                  <span className="flex gap-2 text-xs text-muted-foreground">
                    <span className="uppercase">{t(`units.${entry.unit}`)}</span>
                    {toggle.reason && <span>{t(`blockers.${toggle.reason}`)}</span>}
                  </span>
                </div>
                <Switch
                  aria-label={resolveLabel(entry.label, locale, (key) => t(key as never))}
                  checked={toggle.checked}
                  disabled={toggle.disabled || !data?.enabled || update.isPending}
                  onCheckedChange={(on) =>
                    update.mutate(
                      { classes: { [entry.id]: { mode: on ? 'prefer' : 'off' } } },
                      { onError },
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      )}

      <JevToggle />

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {share !== null && (
          <span>{t('card.share', { percent: share, days: data?.usage.days ?? 7 })}</span>
        )}
        {data?.latencyMsP50 != null && (
          <span>{t('card.latency', { ms: Math.round(data.latencyMsP50) })}</span>
        )}
        <Link
          href={LOCAL_AI_SETTINGS_HREF}
          className="ms-auto inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          {t('card.settings')}
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </footer>
    </section>
  );
}

function UnitTile({
  unit,
  status,
  pending,
  onToggle,
}: {
  unit: LocalAiUnit;
  status: LocalAiStatus;
  pending: boolean;
  onToggle: (allowed: boolean) => void;
}) {
  const t = useTranslations('localAi');
  const entry = status.units[unit];
  const state = unitState(status, unit);
  const loaded = entry.loaded.map((model) => shortModel(model.modelId));
  const gpu = unit === 'gpu' ? status.units.gpu : null;
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="font-medium">{t(`units.${unit}`)}</span>
        <span className="text-xs text-muted-foreground">{t(`unitStates.${state}`)}</span>
        <Switch
          className="ms-auto"
          aria-label={t('card.unitSwitch', { unit: t(`units.${unit}`) })}
          checked={entry.allowed}
          disabled={pending}
          onCheckedChange={onToggle}
        />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{percent(entry.busyPercent)}</span>
        {gpu && gpu.vramTotalBytes != null && (
          <span>
            {t('card.vram', { used: gib(gpu.vramUsedBytes), total: gib(gpu.vramTotalBytes) })}
          </span>
        )}
      </div>
      {loaded.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate text-xs">{loaded.join(', ')}</span>
          </TooltipTrigger>
          <TooltipContent>{loaded.join(', ')}</TooltipContent>
        </Tooltip>
      ) : (
        <span className="text-xs text-muted-foreground">{t('card.noModel')}</span>
      )}
    </div>
  );
}
