import type { HostHealthItem } from '@helena/sdk';
import type {
  BackupStatus,
  BootEntryCheck,
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
const CPU_HOT_C = 95;
const CPU_CRITICAL_C = 100;
const CPU_HOT_MS = 10 * 60_000;

export function storageHealth(
  storage: StorageStatus,
  events?: HostEvents | null,
  warningTimes?: Map<string, number>,
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
    const warningTime = smart?.warningTempTime;
    const previousWarningTime = warningTimes?.get(disk.kname);
    if (warningTime != null && warningTimes) warningTimes.set(disk.kname, warningTime);
    if (!smart || smart.error) {
      items.push({ id, state: 'unknown', code: 'diskUnknown', values: { disk: label } });
      continue;
    }
    const spareLow =
      smart.availableSpare !== null &&
      smart.availableSpareThreshold !== null &&
      smart.availableSpare <= smart.availableSpareThreshold;
    if (
      smart.failing ||
      smart.criticalWarning ||
      (warningTime != null && previousWarningTime != null && warningTime > previousWarningTime)
    ) {
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
  items.push(
    ...espSyncHealth(storage.esp.sync),
    ...removableHealth(storage.esp.removable),
    ...bootEntryHealth(storage.bootEntries),
  );
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

// The copy of the first ESP onto the second after a package change. Failed is red: the
// reserve boot may start a half-written or stale loader. Skipped (a mount missing) is amber,
// and only while the mirror may lack something (`pending`); it stays until a copy works.
function espSyncHealth(sync: StorageStatus['esp']['sync']): HostHealthItem[] {
  if (!sync) return [];
  if (sync.state === 'failed') {
    return [
      {
        id: 'esp:sync',
        state: 'critical',
        code: 'espSyncFailed',
        values: { reason: sync.reason ?? 'unknown', at: sync.at ?? '' },
        since: sync.at,
      },
    ];
  }
  if (sync.state === 'skipped' && sync.pending) {
    return [
      {
        id: 'esp:sync',
        state: 'attention',
        code: 'espSyncSkipped',
        values: { reason: sync.reason ?? 'unknown', mount: sync.mount ?? '', at: sync.at ?? '' },
        since: sync.at,
      },
    ];
  }
  return [];
}

// The firmware's removable path (EFI/BOOT): amber when it would start other binaries than the
// entries, a shim fallback, or a stub that does not find the root. The AXB35 firmware boots it
// on its own ("UEFI OS") now and then.
function removableHealth(states: StorageStatus['esp']['removable']): HostHealthItem[] {
  return (states ?? [])
    .filter((removable) => removable.state !== 'ok' && removable.state !== 'unknown')
    .map((removable) => ({
      id: `esp:removable:${removable.mount}`,
      state: 'attention' as const,
      code: 'espRemovableStale',
      values: { mount: removable.mount, problem: removable.state },
    }));
}

// The firmware entries of both ESPs. A wrong one is amber: helena-boot-entries.service repairs
// it at the next boot when its ESP is there (`repair: nextBoot`), once the disk is back
// otherwise (`diskMissing`). An entry whose ESP is away but looks right (`unchecked`) says
// nothing: the RAID and ESP lines already tell about the disk. An entry still on the old loader
// folder (`oldLayout`) starts fine and counts as right.
function bootEntryHealth(checks: BootEntryCheck[] | undefined): HostHealthItem[] {
  if (!checks || checks.length === 0) return [];
  const items: HostHealthItem[] = [];
  for (const check of checks) {
    const id = `boot:${check.role}`;
    const repair = check.espPresent ? 'nextBoot' : 'diskMissing';
    const label = check.label;
    switch (check.state) {
      case 'ok':
      case 'oldLayout':
      case 'unchecked':
        break;
      case 'missing':
        items.push({ id, state: 'attention', code: 'bootEntryMissing', values: { label, repair } });
        break;
      case 'duplicate':
        items.push({
          id,
          state: 'attention',
          code: 'bootEntryDuplicate',
          values: { label, repair },
        });
        break;
      case 'loaderMissing':
        items.push({
          id,
          state: 'attention',
          code: 'bootLoaderMissing',
          values: { label, mount: check.mount },
        });
        break;
      default:
        items.push({
          id,
          state: 'attention',
          code: 'bootEntryBroken',
          values: { label, problem: check.state, repair },
        });
    }
  }
  if (
    items.length === 0 &&
    checks.every((check) => check.state === 'ok' || check.state === 'oldLayout')
  ) {
    items.push({
      id: 'boot',
      state: 'ok',
      code: 'bootEntriesOk',
      values: { count: checks.length },
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
  if (power.fanControlExpected) {
    if (!power.fanModuleLoaded) {
      items.push({
        id: 'fans:hardware',
        state: 'critical',
        code: 'fanModuleMissing',
        text: {
          de: 'Lüftermodul fehlt für den laufenden Kernel.',
          en: 'Fan module missing for the running kernel.',
        },
      });
    } else if (
      !power.ec ||
      power.ec.fans.length !== 3 ||
      power.ec.fans.some((fan) => fan.rpm === null)
    ) {
      items.push({
        id: 'fans:hardware',
        state: 'critical',
        code: 'fanSensorsUnreadable',
        text: { de: 'Lüfterwerte sind nicht lesbar.', en: 'Fan readings are unavailable.' },
      });
    }
  }
  const temperature = power.cpuTemperatureC;
  const tctl = power.temperatures.find(
    (sensor) => sensor.sensor === 'k10temp' && sensor.label === 'Tctl',
  )?.celsius;
  const ec = power.ec?.temperatureC;
  const since = power.guard.state.thermalWarnSince;
  const hotLongEnough =
    tctl != null &&
    tctl >= CPU_HOT_C &&
    ec != null &&
    ec >= CPU_HOT_C &&
    since != null &&
    Date.now() - Date.parse(since) >= CPU_HOT_MS;
  const fansAtMax = power.fans?.mode === 'fixed' && power.fans.level === 5;
  const critical =
    (temperature != null && temperature >= CPU_CRITICAL_C) ||
    (power.guard.state.throttling === true && !fansAtMax);
  if (temperature !== null) {
    items.push({
      id: 'cpu:temperature',
      state: critical ? 'critical' : hotLongEnough ? 'attention' : 'ok',
      code: critical || hotLongEnough ? 'cpuHot' : 'cpuTemperature',
      values: { temperature: Math.round(temperature) },
    });
  }
  if (power.fans && !items.some((item) => item.id === 'fans:hardware')) {
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
  const items: HostHealthItem[] = [
    {
      id: 'memory',
      state: system.memory.underPressure ? 'attention' : 'ok',
      code: system.memory.underPressure ? 'memoryPressure' : 'memoryOk',
      values: { available },
    },
  ];
  if (system.guard?.problem) {
    items.push({
      id: 'local-ai:guard',
      state: 'critical',
      code: system.guard.problem === 'eviction' ? 'localAiEviction' : 'localAiProbeSlow',
      values: { available, seconds: Math.ceil((system.guard.probeMs ?? 0) / 1000) },
    });
  }
  return items;
}
