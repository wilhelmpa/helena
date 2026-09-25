import type { HostHealthItem, ServerOverview } from '@/lib/api/endpoints/server';
import type { ServerTab } from './serverFormat';
import { worstState } from './serverFormat';

// The machine on Start (docs/helena-decisions/dashboard.md): its red problems go into
// "Braucht dich", each linked to its tab of Administrator → Server; its state and a short
// line (the mirror, the last backup, the CPU) fold into the System tile. Free of React.

// Every health line of the capabilities this host offers.
export function serverHealthItems(overview: ServerOverview | undefined): HostHealthItem[] {
  return (overview?.capabilities ?? [])
    .filter((capability) => capability.available)
    .flatMap((capability) => capability.health);
}

// The tab of Administrator → Server a health line is looked at on.
export function serverTabOf(id: string): ServerTab {
  if (/^(raid|disk|esp|events)(:|$)/.test(id)) return 'disks';
  if (id.startsWith('backup')) return 'backup';
  if (/^(cpu|fans|power)(:|$)/.test(id)) return 'power';
  return 'overview';
}

// What the owner has to see in "Braucht dich": every red line (a degraded mirror, a failing
// disk, a failed backup, check or restore test, a CPU too hot), and the thermal guard that
// raised the fans although it is only amber on the Server page.
export function redServerItems(items: HostHealthItem[]): HostHealthItem[] {
  return items.filter((item) => item.state === 'critical' || item.id === 'fans:guard');
}

// The lines the System tile counts as problems (red and amber).
export function serverProblems(items: HostHealthItem[]): HostHealthItem[] {
  return items.filter((item) => item.state === 'critical' || item.state === 'attention');
}

export function serverState(items: HostHealthItem[]) {
  return worstState(items.map((item) => item.state));
}

// The short line for the System tile while all is well: the mirror, the last backup and the
// CPU's temperature, each only when the host reports it.
export interface ServerGlance {
  raidOk: boolean;
  backupAt: string | null;
  cpuTemperature: number | null;
}

export function serverGlance(items: HostHealthItem[]): ServerGlance {
  const raids = items.filter((item) => item.id.startsWith('raid:'));
  const backup = items.find((item) => item.id === 'backup:last' && item.code === 'backupOk');
  const cpu = items.find((item) => item.id === 'cpu:temperature');
  const at = backup?.values?.at;
  const temperature = cpu?.values?.temperature;
  return {
    raidOk: raids.length > 0 && raids.every((item) => item.state === 'ok'),
    backupAt: typeof at === 'string' && at ? at : null,
    cpuTemperature: typeof temperature === 'number' ? temperature : null,
  };
}
