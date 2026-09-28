'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Fan, Gauge, Leaf, Scale, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import CopyableCommand from '@/components/common/page/CopyableCommand';
import StatusBadge from '@/components/common/page/StatusBadge';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PowerProfile, PowerStatus } from '@/lib/api/endpoints/server';
import { cn } from '@/lib/utils';
import { formatDurationShort } from '@/utils/dates';
import {
  serverKeys,
  useServerDisks,
  useServerPower,
  useSetFans,
  useSetGuardLimit,
  useSetPowerProfile,
} from '../services/server.service';
import { fansChoice, formatCelsius, formatWatts, type ServerTab } from '../utils/serverFormat';
import { CardHeader, Fact, Facts, ServerSections } from './ServerParts';
import ServerToolbar from './ServerToolbar';

const CARD = 'min-w-0 space-y-3 rounded-md border border-sidebar-border bg-card p-4';
const PROFILES: { value: PowerProfile; icon: typeof Leaf }[] = [
  { value: 'saver', icon: Leaf },
  { value: 'balanced', icon: Scale },
  { value: 'performance', icon: Zap },
];
const GUARD_LIMITS = [80, 85, 90, 95];

// A segmented choice in the sidebar's look: 32px buttons side by side, the chosen one filled.
function Choice({
  selected,
  disabled,
  onClick,
  children,
  label,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 min-w-10 items-center justify-center gap-1.5 rounded-md border border-sidebar-border px-3 text-sm transition-colors hover:bg-sidebar-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
        selected && 'bg-sidebar-accent font-medium',
      )}
    >
      {children}
    </button>
  );
}

// Server → Leistung & Lüfter: one profile sets the EC's power mode ("BIOS"), the OS profile
// (power-profiles-daemon) and, where configured, ryzenadj limits — each layer shown with what
// is really active. The three fans together: automatic (the EC's own curve) or a fixed level
// 1–5, with the thermal guard that raises fixed fans to 5 when the CPU runs hot.
export default function PowerTab({ tabs }: { tabs: ServerTab[] }) {
  const t = useTranslations('server.power');
  const tServer = useTranslations('server');
  const tCommon = useTranslations('common');
  const qc = useQueryClient();
  const power = useServerPower();
  const data = power.data;

  return (
    <>
      <ServerToolbar
        tab="power"
        tabs={tabs}
        refreshing={power.isFetching}
        onRefresh={() => void qc.invalidateQueries({ queryKey: serverKeys.power })}
      />
      {!data ? (
        power.isError ? (
          <p className="text-sm text-muted-foreground">{tServer('readFailed')}</p>
        ) : (
          <ListSkeleton rows={4} rowClassName="h-20" />
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {!data.available.ec && !data.available.os && (
            <section className={`${CARD} xl:col-span-2`}>
              <CardHeader title={t('notInstalled.title')} />
              <p className="text-sm text-muted-foreground">
                {t('notInstalled.description', { board: data.board ?? '–' })}
              </p>
              <CopyableCommand
                command="sudo deployment/volition-stack/native/server/fans/install-fan-control.sh --from-clones /home/wilhelmpa/Projekte/Linux install"
                copyLabel={tCommon('copy')}
                copiedLabel={tCommon('copied')}
              />
            </section>
          )}
          {(data.available.ec || data.available.os) && <ProfileCard data={data} />}
          {data.available.ec && <FansCard data={data} />}
          <TemperatureCard data={data} />
          {data.available.ec && <GuardCard data={data} />}
          <ServerSections area="power" />
        </div>
      )}
    </>
  );
}

function ProfileCard({ data }: { data: PowerStatus }) {
  const t = useTranslations('server.power');
  const set = useSetPowerProfile();
  const desired = data.desired.profile ?? null;
  const active = data.profile;
  const shown: PowerProfile = desired ?? (active && active !== 'mixed' ? active : 'balanced');
  const ryzenadj = data.ryzenadj;

  return (
    <section className={`${CARD} xl:col-span-2`}>
      <CardHeader title={t('profile.title')}>
        {active === 'mixed' && (
          <span className="text-xs text-status-waiting">{t('profile.mixed')}</span>
        )}
      </CardHeader>
      <div className="flex flex-wrap gap-2">
        {PROFILES.map(({ value, icon: Icon }) => (
          <Choice
            key={value}
            selected={shown === value && (desired !== null || active === value)}
            disabled={set.isPending}
            onClick={() =>
              set.mutate(value, {
                onSuccess: (result) => {
                  const failed = Object.entries(result.layers).filter(([, layer]) => !layer.ok);
                  if (failed.length === 0)
                    toast.success(t('profile.set', { profile: t(`profile.${value}`) }));
                  else
                    toast.warning(
                      t('profile.partly', {
                        layers: failed.map(([name]) => t(`layer.${name}` as never)).join(', '),
                      }),
                    );
                },
              })
            }
          >
            <Icon />
            {t(`profile.${value}`)}
          </Choice>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t(`profile.explain.${shown}`, {
          stapm: data.profiles[shown]?.ecLimitsW.stapm ?? '–',
          fast: data.profiles[shown]?.ecLimitsW.fast ?? '–',
        })}
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Layer
          title={t('layer.ec')}
          available={data.available.ec}
          value={data.ec?.powerMode ? t(`ecMode.${data.ec.powerMode}` as never) : '–'}
          detail={
            data.ec?.powerMode && data.ec.powerMode in { quiet: 1, balanced: 1, performance: 1 }
              ? t('layer.ecLimits', {
                  ...Object.values(data.profiles).find(
                    (profile) => profile.ec === data.ec?.powerMode,
                  )?.ecLimitsW,
                })
              : null
          }
        />
        <Layer
          title={t('layer.os')}
          available={data.available.os}
          value={data.os?.profile ? t(`osProfile.${data.os.profile}` as never) : '–'}
          detail={
            data.cpu.epp
              ? t('layer.epp', { epp: data.cpu.epp, driver: data.cpu.driver ?? '–' })
              : null
          }
        />
        <Layer
          title={t('layer.ryzenadj')}
          available={!!ryzenadj?.available}
          value={
            ryzenadj?.available
              ? t('layer.limits', {
                  stapm: formatWatts(ryzenadj.stapmLimitW),
                  fast: formatWatts(ryzenadj.fastLimitW),
                  slow: formatWatts(ryzenadj.slowLimitW),
                })
              : ryzenadj?.reason === 'no_smu_driver'
                ? t('layer.noSmu')
                : t('layer.notInstalled')
          }
          detail={
            ryzenadj?.available
              ? t('layer.now', {
                  power: formatWatts(ryzenadj.stapmValueW),
                  tctl: formatCelsius(ryzenadj.tctlValueC),
                  limit: formatCelsius(ryzenadj.tctlLimitC),
                })
              : null
          }
        />
      </div>
    </section>
  );
}

function Layer({
  title,
  available,
  value,
  detail,
}: {
  title: string;
  available: boolean;
  value: string;
  detail: string | null;
}) {
  const t = useTranslations('server.power');
  return (
    <div className="min-w-0 space-y-0.5 rounded-md border border-sidebar-border p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <StatusBadge status={available ? 'success' : 'idle'} dotOnly />
        {title}
      </div>
      <div className="truncate text-sm font-medium">
        {available ? value : t('layer.unavailable')}
      </div>
      {available && detail && <div className="text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}

function FansCard({ data }: { data: PowerStatus }) {
  const t = useTranslations('server.power');
  const set = useSetFans();
  const choice = fansChoice(data);
  const guardActive = data.guard.state.active;
  const apply = (next: 'auto' | number) =>
    set.mutate(next === 'auto' ? { mode: 'auto' } : { mode: 'fixed', level: next }, {
      onSuccess: (result) => {
        if (!result.applied) toast.info(t('fans.heldByGuard'));
      },
    });

  return (
    <section className={CARD}>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Fan className="size-4 text-muted-foreground" />
            {t('fans.title')}
          </span>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Choice selected={choice === 'auto'} disabled={set.isPending} onClick={() => apply('auto')}>
          {t('fans.auto')}
        </Choice>
        {/* The five levels stay one row, also where they wrap under "Automatisch". */}
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((level) => (
            <Choice
              key={level}
              selected={choice === level}
              disabled={set.isPending}
              label={t('fans.level', { level })}
              onClick={() => apply(level)}
            >
              {level}
            </Choice>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {choice === 'auto'
          ? t('fans.autoExplain')
          : typeof choice === 'number'
            ? t('fans.fixedExplain', { percent: choice * 20 })
            : t('fans.unknown')}
      </p>
      {guardActive && (
        <p className="text-xs text-status-waiting">
          {t('fans.guardActive', {
            temperature: formatCelsius(data.guard.state.peakC ?? data.cpuTemperatureC),
            since: data.guard.state.engagedAt
              ? formatDurationShort(data.guard.state.engagedAt)
              : '',
          })}
        </p>
      )}
      <ul className="space-y-1">
        {(data.ec?.fans ?? []).map((fan) => (
          <li key={fan.id} className="flex min-w-0 items-center gap-2 text-sm">
            <Gauge className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{t(`fans.name.${fan.id}` as never)}</span>
            <span className="shrink-0 tabular-nums">
              {fan.rpm !== null ? t('fans.rpm', { rpm: fan.rpm }) : '–'}
            </span>
            <span className="w-24 shrink-0 text-end text-xs text-muted-foreground">
              {fan.mode === 'auto'
                ? t('fans.auto')
                : fan.level !== null
                  ? t('fans.level', { level: fan.level })
                  : '–'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TemperatureCard({ data }: { data: PowerStatus }) {
  const t = useTranslations('server.power');
  const disks = useServerDisks();
  const letterOf = (kname: string | null | undefined) =>
    disks.data?.storage.disks.find((disk) => disk.kname === kname)?.letter ?? kname ?? '';
  const label = (sensor: PowerStatus['temperatures'][number]) => {
    if (sensor.sensor === 'k10temp') return t('sensor.cpu');
    if (sensor.sensor === 'amdgpu' && sensor.watts !== undefined) return t('sensor.gpuPower');
    if (sensor.sensor === 'amdgpu') return t('sensor.gpu');
    if (sensor.sensor === 'nvme') return t('sensor.nvme', { id: letterOf(sensor.disk) });
    if (sensor.sensor === 'acpitz') return t('sensor.board');
    return sensor.label ?? sensor.sensor;
  };
  return (
    <section className={CARD}>
      <CardHeader title={t('temperatures.title')} />
      <Facts className="sm:grid-cols-2 xl:grid-cols-2">
        {data.ec?.temperatureC != null && (
          <Fact label={t('sensor.ec')}>
            {formatCelsius(data.ec.temperatureC)}
            <span className="text-xs text-muted-foreground">
              {' · '}
              {t('temperatures.max', { max: formatCelsius(data.ec.temperatureMaxC) })}
            </span>
          </Fact>
        )}
        {data.temperatures.map((sensor) => (
          <Fact key={sensor.id} label={label(sensor)}>
            {sensor.watts !== undefined ? formatWatts(sensor.watts) : formatCelsius(sensor.celsius)}
          </Fact>
        ))}
      </Facts>
    </section>
  );
}

function GuardCard({ data }: { data: PowerStatus }) {
  const t = useTranslations('server.power');
  const set = useSetGuardLimit();
  const limit = data.guard.limit ?? 90;
  return (
    <section className={CARD}>
      <CardHeader title={t('guard.title')} />
      <p className="text-xs text-muted-foreground">
        {t('guard.explain', {
          limit: formatCelsius(limit),
          release: formatCelsius(data.guard.releaseBelow ?? 80),
        })}
      </p>
      <label className="flex items-center gap-3 text-sm">
        <span>{t('guard.limit')}</span>
        <Select
          value={String(limit)}
          onValueChange={(value) =>
            set.mutate(Number(value), { onSuccess: () => toast.success(t('guard.saved')) })
          }
        >
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GUARD_LIMITS.map((value) => (
              <SelectItem key={value} value={String(value)}>
                {formatCelsius(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <p className="flex items-center gap-2 text-sm">
        <StatusBadge status={data.guard.state.active ? 'waiting' : 'success'} dotOnly />
        {data.guard.state.active
          ? t('guard.active')
          : data.guard.state.available
            ? t('guard.watching')
            : t('guard.waitingForDriver')}
      </p>
    </section>
  );
}
