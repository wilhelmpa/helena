import type { HostHealthItem } from '@helena/sdk';
import type {
  BackupStatus,
  HostEvents,
  HostSystemStatus,
  PowerStatus,
  StorageStatus,
} from './types';

// The health lines of the machine for the overview on Start and the Server area: red
// (`critical`) for what needs the owner now, amber (`attention`) for what runs or needs a
// look, green for the rest. Each line is a message of the web's translations
// (`server.health.<code>`) with its values; nothing here is a sentence.

// How old the last backup may get before it counts as late: two intervals and a margin.
const BACKUP_LATE_MS: Record<BackupStatus['schedule']['frequency'], number | null> = {
  off: null,
  hourly: 3 * 3_600_000,
  every6h: 14 * 3_600_000,
  daily: 36 * 3_600_000,
};
const CPU_WARM_C = 85;
const CPU_HOT_C = 95;

export function storageHealth(
  storage: StorageStatus,
  events?: HostEvents | null,
): HostHealthItem[] {
  const items: HostHealthItem[] = [];
  for (const array of storage.arrays) {
    const name = array.name;
    const percent = array.syncPercent ?? 0;
    if (array.degraded > 0 && (array.syncAction === 'recover' || array.syncAction === 'resync')) {
      items.push({
        id: `raid:${name}`,
        state: 'attention',
        code: 'raidRebuilding',
        values: { name, percent, remaining: array.syncRemainingSeconds ?? 0 },
      });
    } else if (array.degraded > 0) {
      items.push({
        id: `raid:${name}`,
        state: 'critical',
        code: 'raidDegraded',
        values: { name, missing: array.degraded },
      });
    } else if (array.syncAction === 'check' || array.syncAction === 'repair') {
      items.push({
        id: `raid:${name}`,
        state: 'attention',
        code: 'raidChecking',
        values: { name, percent, remaining: array.syncRemainingSeconds ?? 0 },
      });
    } else if (array.syncAction === 'resync' || array.syncAction === 'reshape') {
      items.push({
        id: `raid:${name}`,
        state: 'attention',
        code: 'raidResyncing',
        values: { name, percent },
      });
    } else if (array.mismatchCount) {
      items.push({
        id: `raid:${name}`,
        state: 'attention',
        code: 'raidMismatches',
        values: { name, count: array.mismatchCount },
      });
    } else {
      items.push({
        id: `raid:${name}`,
        state: 'ok',
        code: 'raidOk',
        values: { name, disks: array.raidDisks ?? array.members.length },
      });
    }
  }
  for (const disk of storage.disks) {
    const label = disk.letter ?? disk.kname;
    const smart = disk.smart;
    const id = `disk:${label}`;
    if (!smart || smart.error) {
      items.push({ id, state: 'unknown', code: 'diskUnknown', values: { disk: label } });
      continue;
    }
    const spareLow =
      smart.availableSpare !== null &&
      smart.availableSpareThreshold !== null &&
      smart.availableSpare <= smart.availableSpareThreshold;
    if (smart.failing || smart.criticalWarning) {
      items.push({ id, state: 'critical', code: 'diskFailing', values: { disk: label } });
    } else if (spareLow) {
      items.push({
        id,
        state: 'critical',
        code: 'diskSpareLow',
        values: { disk: label, spare: smart.availableSpare ?? 0 },
      });
    } else if (smart.pendingSectors || smart.thresholdReached || (smart.mediaErrors ?? 0) > 0) {
      items.push({
        id,
        state: 'attention',
        code: 'diskErrors',
        values: { disk: label, count: (smart.mediaErrors ?? 0) + (smart.pendingSectors ?? 0) },
      });
    } else if ((smart.wearPercent ?? 0) >= 90) {
      items.push({
        id,
        state: 'attention',
        code: 'diskWorn',
        values: { disk: label, wear: smart.wearPercent ?? 0 },
      });
    } else if ((smart.temperatureC ?? 0) >= 70) {
      items.push({
        id,
        state: 'attention',
        code: 'diskHot',
        values: { disk: label, temperature: smart.temperatureC ?? 0 },
      });
    } else {
      items.push({
        id,
        state: 'ok',
        code: 'diskOk',
        values: {
          disk: label,
          temperature: smart.temperatureC ?? 0,
          wear: smart.wearPercent ?? 0,
        },
      });
    }
  }
  const missing = storage.esp.mounts.filter((mount) => !mount.mounted);
  if (missing.length > 0) {
    items.push({
      id: 'esp',
      state: 'attention',
      code: 'espNotMounted',
      values: { mount: missing.map((mount) => mount.mount).join(', ') },
    });
  } else if (storage.esp.inSync === false) {
    items.push({
      id: 'esp',
      state: 'attention',
      code: 'espOutOfSync',
      values: { count: storage.esp.differenceCount },
    });
  } else if (storage.esp.inSync) {
    items.push({ id: 'esp', state: 'ok', code: 'espInSync' });
  }
  if (events && events.unseenCritical > 0) {
    items.push({
      id: 'events',
      state: 'critical',
      code: 'eventsCritical',
      values: { count: events.unseenCritical },
    });
  }
  return items;
}

export function backupHealth(backup: BackupStatus, now: number = Date.now()): HostHealthItem[] {
  const items: HostHealthItem[] = [];
  if (!backup.installed) return items;
  const last = backup.last.backup;
  const finished = last?.finishedAt ?? null;
  if (!backup.initialized) {
    items.push({ id: 'backup:last', state: 'attention', code: 'backupNotInitialized' });
  } else if (!last) {
    items.push({
      id: 'backup:last',
      state: backup.running.backup ? 'ok' : 'attention',
      code: backup.running.backup ? 'backupRunning' : 'backupNever',
    });
  } else if (!last.ok) {
    items.push({
      id: 'backup:last',
      state: 'critical',
      code: 'backupFailed',
      values: { at: finished ?? '' },
      since: finished,
    });
  } else {
    const late = BACKUP_LATE_MS[backup.schedule.frequency];
    const age = finished ? now - Date.parse(finished) : Infinity;
    items.push({
      id: 'backup:last',
      state: late !== null && age > late ? 'attention' : 'ok',
      code: late !== null && age > late ? 'backupLate' : 'backupOk',
      values: { at: finished ?? '' },
      since: finished,
    });
  }
  if (backup.passwordState === 'unrevealed') {
    items.push({ id: 'backup:password', state: 'attention', code: 'backupPasswordPending' });
  }
  const maintenance = backup.last.maintenance;
  if (maintenance && !maintenance.ok) {
    items.push({
      id: 'backup:check',
      state: 'critical',
      code: 'backupCheckFailed',
      values: { at: maintenance.finishedAt ?? '' },
    });
  }
  const test = backup.last['restore-test'];
  if (test && !test.ok) {
    items.push({
      id: 'backup:restore-test',
      state: 'critical',
      code: 'restoreTestFailed',
      values: { at: test.finishedAt ?? '' },
    });
  }
  for (const target of backup.targets) {
    if (target.enabled && target.lastCopy && !target.lastCopy.ok) {
      items.push({
        id: `backup:target:${target.id}`,
        state: 'attention',
        code: 'backupTargetFailed',
        values: { target: target.id },
      });
    }
  }
  return items;
}

export function powerHealth(power: PowerStatus): HostHealthItem[] {
  const items: HostHealthItem[] = [];
  const temperature = power.cpuTemperatureC;
  if (power.guard.state.active) {
    items.push({
      id: 'fans:guard',
      state: 'attention',
      code: 'fansRaised',
      values: { temperature: power.guard.state.peakC ?? temperature ?? 0 },
      since: power.guard.state.engagedAt ?? null,
    });
  }
  if (temperature !== null) {
    items.push({
      id: 'cpu:temperature',
      state: temperature >= CPU_HOT_C ? 'critical' : temperature >= CPU_WARM_C ? 'attention' : 'ok',
      code: temperature >= CPU_WARM_C ? 'cpuHot' : 'cpuTemperature',
      values: { temperature: Math.round(temperature) },
    });
  }
  if (power.fans) {
    items.push({
      id: 'fans',
      state: 'ok',
      code: power.fans.mode === 'fixed' ? 'fansFixed' : 'fansAuto',
      values: { level: power.fans.level ?? 0 },
    });
  }
  return items;
}

export function systemHealth(system: HostSystemStatus): HostHealthItem[] {
  const available = system.memory.availableBytes ?? 0;
  return [
    {
      id: 'memory',
      state: system.memory.underPressure ? 'attention' : 'ok',
      code: system.memory.underPressure ? 'memoryPressure' : 'memoryOk',
      values: { available },
    },
  ];
}
