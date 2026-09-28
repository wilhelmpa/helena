import { describe, expect, it } from 'bun:test';
import { backupHealth, powerHealth, storageHealth, systemHealth } from '../../health';
import type { BootEntryCheck, EspSyncState } from '../../types';
import { backup, power, storage } from '../fixtures';

// The machine's health lines: red for what needs the owner now, amber for what runs or
// needs a look.

const byId = (items: { id: string }[], id: string) => items.find((item) => item.id === id);

describe('storage health', () => {
  it('a rebuild in progress is amber with its progress, the disks green', () => {
    const items = storageHealth(storage());
    expect(byId(items, 'raid:helena-root')).toMatchObject({
      state: 'attention',
      code: 'raidRebuilding',
      values: { name: 'helena-root', percent: 26.5, remaining: 8840 },
    });
    expect(byId(items, 'disk:A')).toMatchObject({ state: 'ok', code: 'diskOk' });
    expect(byId(items, 'esp')).toMatchObject({ state: 'ok', code: 'espInSync' });
  });

  it('a degraded array without a rebuild is red', () => {
    const base = storage();
    const items = storageHealth({
      ...base,
      arrays: [{ ...base.arrays[0]!, syncAction: 'idle', syncPercent: null }],
    });
    expect(byId(items, 'raid:helena-root')).toMatchObject({
      state: 'critical',
      code: 'raidDegraded',
    });
  });

  it('a check is amber, mismatches afterwards too, a clean array green', () => {
    const base = storage();
    const array = { ...base.arrays[0]!, degraded: 0 };
    expect(
      byId(
        storageHealth({ ...base, arrays: [{ ...array, syncAction: 'check' }] }),
        'raid:helena-root',
      ),
    ).toMatchObject({ state: 'attention', code: 'raidChecking' });
    expect(
      byId(
        storageHealth({ ...base, arrays: [{ ...array, syncAction: 'idle', mismatchCount: 128 }] }),
        'raid:helena-root',
      ),
    ).toMatchObject({ state: 'attention', code: 'raidMismatches', values: { count: 128 } });
    expect(
      byId(
        storageHealth({ ...base, arrays: [{ ...array, syncAction: 'idle' }] }),
        'raid:helena-root',
      ),
    ).toMatchObject({ state: 'ok', code: 'raidOk', values: { disks: 2 } });
  });

  it('a failing disk is red, a worn or hot one amber', () => {
    const base = storage();
    const disk = base.disks[1]!;
    const withSmart = (smart: Partial<NonNullable<typeof disk.smart>>) =>
      byId(
        storageHealth({ ...base, disks: [{ ...disk, smart: { ...disk.smart!, ...smart } }] }),
        'disk:B',
      );
    expect(withSmart({ failing: true })).toMatchObject({ state: 'critical', code: 'diskFailing' });
    expect(withSmart({ availableSpare: 5 })).toMatchObject({
      state: 'critical',
      code: 'diskSpareLow',
    });
    expect(withSmart({ mediaErrors: 2 })).toMatchObject({ state: 'attention', code: 'diskErrors' });
    expect(withSmart({ wearPercent: 93 })).toMatchObject({ state: 'attention', code: 'diskWorn' });
    expect(withSmart({ temperatureC: 72 })).toMatchObject({ state: 'attention', code: 'diskHot' });
  });

  it('treats a rising NVMe warning-temperature counter as critical', () => {
    const base = storage();
    const times = new Map<string, number>();
    const disk = base.disks[1]!;
    const withTime = (warningTempTime: number) =>
      storageHealth(
        {
          ...base,
          disks: [{ ...disk, smart: { ...disk.smart!, warningTempTime } }],
        },
        null,
        times,
      );
    expect(byId(withTime(12), 'disk:B')).toMatchObject({ state: 'ok' });
    expect(byId(withTime(13), 'disk:B')).toMatchObject({ state: 'critical' });
    expect(byId(withTime(13), 'disk:B')).toMatchObject({ state: 'ok' });
  });

  it('ESPs out of step are amber, and unseen critical events red', () => {
    const base = storage();
    const items = storageHealth(
      { ...base, esp: { ...base.esp, inSync: false, differenceCount: 3 } },
      { events: [], seenUpTo: 0, unseen: 2, unseenCritical: 1 },
    );
    expect(byId(items, 'esp')).toMatchObject({ state: 'attention', code: 'espOutOfSync' });
    expect(byId(items, 'events')).toMatchObject({ state: 'critical', values: { count: 1 } });
  });
});

describe('ESP copy and boot entries (the 2026-09-25 disk that fell off the bus)', () => {
  const sync = (over: Partial<EspSyncState>): EspSyncState => ({
    state: 'ok',
    reason: null,
    at: '2026-09-25T16:30:00Z',
    mount: '/boot/efi2',
    pending: false,
    syncedAt: '2026-09-25T10:00:00Z',
    detail: null,
    ...over,
  });
  const withSync = (value: EspSyncState) => {
    const base = storage();
    return byId(storageHealth({ ...base, esp: { ...base.esp, sync: value } }), 'esp:sync');
  };

  it('a failed copy is red, a skipped one amber only while the mirror may lack something', () => {
    expect(
      withSync(sync({ state: 'failed', reason: 'readFailed', mount: '/boot/efi' })),
    ).toMatchObject({ state: 'critical', code: 'espSyncFailed', values: { reason: 'readFailed' } });
    expect(withSync(sync({ state: 'skipped', reason: 'notMounted', pending: true }))).toMatchObject(
      {
        state: 'attention',
        code: 'espSyncSkipped',
        values: { reason: 'notMounted', mount: '/boot/efi2', at: '2026-09-25T16:30:00Z' },
        since: '2026-09-25T16:30:00Z',
      },
    );
    expect(
      withSync(sync({ state: 'skipped', reason: 'notMounted', pending: false })),
    ).toBeUndefined();
    expect(withSync(sync({}))).toBeUndefined();
    // An older helper without the field says nothing.
    expect(byId(storageHealth(storage()), 'esp:sync')).toBeUndefined();
  });

  it('the removable path is amber unless it starts the same binaries (or cannot be compared)', () => {
    const base = storage();
    const items = storageHealth({
      ...base,
      esp: {
        ...base.esp,
        removable: [
          { mount: '/boot/efi', state: 'ok', detail: null },
          { mount: '/boot/efi2', state: 'differs', detail: 'EFI/BOOT/grubx64.efi' },
        ],
      },
    });
    expect(byId(items, 'esp:removable:/boot/efi')).toBeUndefined();
    expect(byId(items, 'esp:removable:/boot/efi2')).toMatchObject({
      state: 'attention',
      code: 'espRemovableStale',
      values: { mount: '/boot/efi2', problem: 'differs' },
    });
    const unknown = storageHealth({
      ...base,
      esp: { ...base.esp, removable: [{ mount: '/boot/efi', state: 'unknown', detail: null }] },
    });
    expect(unknown.some((item) => item.id.startsWith('esp:removable'))).toBe(false);
  });

  const entry = (over: Partial<BootEntryCheck>): BootEntryCheck => ({
    role: 'main',
    label: 'Debian',
    mount: '/boot/efi',
    espPresent: true,
    partuuid: '2a7ccb77-d727-4df5-aa1a-e619e847d2e8',
    number: '0000',
    state: 'ok',
    entries: ['0000'],
    foreign: [],
    ...over,
  });
  const reserve = entry({
    role: 'reserve',
    label: 'Debian (Reserve)',
    mount: '/boot/efi2',
    number: '001A',
    entries: ['001A'],
  });
  const withEntries = (main: Partial<BootEntryCheck>) =>
    storageHealth({ ...storage(), bootEntries: [entry(main), reserve] });

  it('both entries right is one green line', () => {
    const items = withEntries({});
    expect(byId(items, 'boot')).toMatchObject({
      state: 'ok',
      code: 'bootEntriesOk',
      values: { count: 2 },
    });
    expect(byId(items, 'boot:main')).toBeUndefined();
  });

  it('an entry still on the old loader folder counts as right', () => {
    const items = withEntries({ state: 'oldLayout' });
    expect(byId(items, 'boot:main')).toBeUndefined();
    expect(byId(items, 'boot')).toMatchObject({ state: 'ok', code: 'bootEntriesOk' });
  });

  it('an entry the firmware rewrote is amber until the next boot repairs it', () => {
    const items = withEntries({ state: 'noPartuuid', number: '000F', entries: ['000F'] });
    expect(byId(items, 'boot:main')).toMatchObject({
      state: 'attention',
      code: 'bootEntryBroken',
      values: { label: 'Debian', problem: 'noPartuuid', repair: 'nextBoot' },
    });
    expect(byId(items, 'boot')).toBeUndefined();
  });

  it('with its disk away the entry waits for the disk; a plausible one says nothing', () => {
    expect(
      byId(withEntries({ state: 'noPartuuid', espPresent: false, partuuid: null }), 'boot:main'),
    ).toMatchObject({ values: { repair: 'diskMissing' } });
    expect(
      byId(
        withEntries({ state: 'missing', espPresent: false, number: null, entries: [] }),
        'boot:main',
      ),
    ).toMatchObject({
      state: 'attention',
      code: 'bootEntryMissing',
      values: { repair: 'diskMissing' },
    });
    const unchecked = withEntries({ state: 'unchecked', espPresent: false, partuuid: null });
    expect(byId(unchecked, 'boot:main')).toBeUndefined();
    expect(byId(unchecked, 'boot')).toBeUndefined();
  });

  it('duplicates and a missing loader have their own lines', () => {
    expect(byId(withEntries({ state: 'duplicate' }), 'boot:main')).toMatchObject({
      code: 'bootEntryDuplicate',
    });
    expect(byId(withEntries({ state: 'loaderMissing' }), 'boot:main')).toMatchObject({
      code: 'bootLoaderMissing',
      values: { label: 'Debian', mount: '/boot/efi' },
    });
  });
});

describe('backup health', () => {
  it('a recent backup is green, a late one amber, a failed one red', () => {
    expect(byId(backupHealth(backup()), 'backup:last')).toMatchObject({
      state: 'ok',
      code: 'backupOk',
    });
    const old = new Date(Date.now() - 5 * 3_600_000).toISOString();
    expect(
      byId(
        backupHealth(
          backup({
            last: {
              backup: { ok: true, finishedAt: old },
              maintenance: null,
              'restore-test': null,
            },
          }),
        ),
        'backup:last',
      ),
    ).toMatchObject({ state: 'attention', code: 'backupLate' });
    expect(
      byId(
        backupHealth(
          backup({
            last: {
              backup: { ok: false, finishedAt: old, error: 'x' },
              maintenance: null,
              'restore-test': null,
            },
          }),
        ),
        'backup:last',
      ),
    ).toMatchObject({ state: 'critical', code: 'backupFailed' });
  });

  it('a daily schedule is not late after five hours', () => {
    const old = new Date(Date.now() - 5 * 3_600_000).toISOString();
    const status = backup({
      schedule: { frequency: 'daily', time: '03:00' },
      last: { backup: { ok: true, finishedAt: old }, maintenance: null, 'restore-test': null },
    });
    expect(byId(backupHealth(status), 'backup:last')).toMatchObject({ state: 'ok' });
  });

  it('asks for the password to be written down, and reports failed checks', () => {
    const items = backupHealth(
      backup({
        passwordState: 'unrevealed',
        last: {
          backup: { ok: true, finishedAt: new Date().toISOString() },
          maintenance: { ok: false, finishedAt: '2026-09-20T03:40:00Z' },
          'restore-test': { ok: false, finishedAt: '2026-09-06T04:30:00Z' },
        },
      }),
    );
    expect(byId(items, 'backup:password')).toMatchObject({ state: 'attention' });
    expect(byId(items, 'backup:check')).toMatchObject({ state: 'critical' });
    expect(byId(items, 'backup:restore-test')).toMatchObject({ state: 'critical' });
  });

  it('says nothing while backups are not installed', () => {
    expect(backupHealth(backup({ installed: false }))).toEqual([]);
  });
});

describe('power and system health', () => {
  it('reports the CPU, the fans and a raise by the guard', () => {
    const items = powerHealth(power());
    expect(byId(items, 'cpu:temperature')).toMatchObject({
      state: 'ok',
      values: { temperature: 58 },
    });
    expect(byId(items, 'fans')).toMatchObject({ code: 'fansFixed', values: { level: 5 } });
    const hot = powerHealth(
      power({
        cpuTemperatureC: 96,
        guard: { limit: 90, state: { active: true, peakC: 97, engagedAt: '2026-09-24T20:00:00Z' } },
      }),
    );
    expect(byId(hot, 'cpu:temperature')).toMatchObject({ state: 'ok' });
  });

  it('requires both sustained sensors for attention and treats 100 C or uncooled throttling as critical', () => {
    const since = new Date(Date.now() - 601_000).toISOString();
    const reading = power({
      cpuTemperatureC: 96,
      ec: { ...power().ec!, temperatureC: 96 },
      temperatures: [{ sensor: 'k10temp', id: 'hwmon3/temp1', label: 'Tctl', celsius: 96 }],
      guard: { limit: 90, state: { active: false, thermalWarnSince: since } },
    });
    expect(byId(powerHealth(reading), 'cpu:temperature')).toMatchObject({ state: 'attention' });
    expect(
      byId(
        powerHealth({
          ...reading,
          guard: { state: { active: false, thermalWarnSince: new Date().toISOString() } },
        }),
        'cpu:temperature',
      ),
    ).toMatchObject({ state: 'ok' });
    expect(
      byId(powerHealth({ ...reading, cpuTemperatureC: 100 }), 'cpu:temperature'),
    ).toMatchObject({ state: 'critical' });
    expect(
      byId(
        powerHealth({
          ...reading,
          fans: { mode: 'fixed', level: 4 },
          guard: { state: { active: false, throttling: true } },
        }),
        'cpu:temperature',
      ),
    ).toMatchObject({ state: 'critical' });
  });

  it('reports a missing fan module and unreadable fan readings as critical', () => {
    const missing = powerHealth(
      power({ fanControlExpected: true, fanModuleLoaded: false, ec: null, fans: null }),
    );
    expect(byId(missing, 'fans:hardware')).toMatchObject({
      state: 'critical',
      code: 'fanModuleMissing',
    });
    const unreadable = powerHealth(
      power({
        fanControlExpected: true,
        fanModuleLoaded: true,
        ec: { ...power().ec!, fans: [{ ...power().ec!.fans[0]!, rpm: null }] },
      }),
    );
    expect(byId(unreadable, 'fans:hardware')).toMatchObject({
      state: 'critical',
      code: 'fanSensorsUnreadable',
    });
    expect(unreadable.find((item) => item.id === 'fans')).toBeUndefined();
  });

  it('the GPU share of the memory is never pressure, low memory is', () => {
    const base = {
      hostname: 'kingston-server',
      kernel: null,
      boardVendor: null,
      boardName: null,
      productName: null,
      cpuModel: null,
      cpuCount: null,
      uptimeSeconds: 1,
      load: [],
      gpuMemory: {
        vramTotalBytes: 103_079_215_104,
        vramUsedBytes: 0,
        gttTotalBytes: 0,
        gttUsedBytes: 0,
      },
      efi: true,
    };
    const memory = {
      totalBytes: 33_277_624_320,
      availableBytes: 22_139_301_888,
      swapTotalBytes: 0,
      swapFreeBytes: 0,
      pressure: null,
      underPressure: false,
    };
    expect(systemHealth({ ...base, memory })[0]).toMatchObject({ state: 'ok', code: 'memoryOk' });
    expect(systemHealth({ ...base, memory: { ...memory, underPressure: true } })[0]).toMatchObject({
      state: 'attention',
      code: 'memoryPressure',
    });
    const guard = {
      checkedAt: null,
      probeAt: null,
      probeMs: 5_000,
      probeFailures: 3,
      problem: 'probe' as const,
      availableBytes: memory.availableBytes,
      consumers: [],
    };
    expect(byId(systemHealth({ ...base, memory, guard }), 'local-ai:guard')).toMatchObject({
      state: 'critical',
      code: 'localAiProbeSlow',
    });
    expect(
      byId(
        systemHealth({ ...base, memory, guard: { ...guard, problem: 'eviction' } }),
        'local-ai:guard',
      ),
    ).toMatchObject({
      state: 'critical',
      code: 'localAiEviction',
    });
  });
});
