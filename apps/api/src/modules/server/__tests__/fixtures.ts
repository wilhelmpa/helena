import type { BackupStatus, PowerStatus, StorageStatus } from '../types';

// Readings as helena-hostd gives them (deployment/volition-stack/native/server), for the
// API tests: a RAID 1 rebuilding onto its second disk, two NVMe disks, the two ESPs.

export function storage(over: Partial<StorageStatus> = {}): StorageStatus {
  return {
    arrays: [
      {
        kname: 'md127',
        name: 'helena-root',
        level: 'raid1',
        state: 'clean',
        raidDisks: 2,
        degraded: 1,
        syncAction: 'recover',
        syncPercent: 26.5,
        syncSpeedKiB: 162076,
        syncRemainingSeconds: 8840,
        mismatchCount: 0,
        members: [
          { device: 'nvme1n1p2', states: ['in_sync'], slot: 0 },
          { device: 'nvme0n1p2', states: ['spare'], slot: null },
        ],
        health: 'attention',
      },
    ],
    disks: ['A', 'B'].map((letter, index) => ({
      kname: `nvme${1 - index}n1`,
      letter,
      model: index === 0 ? 'Samsung SSD 990 PRO with Heatsink 2TB' : 'KINGSTON OM8TAP42048K1-A00',
      serial: `SERIAL${letter}`,
      sizeBytes: 2_000_398_934_016,
      transport: 'nvme',
      arrays: ['helena-root'],
      mountpoints: index === 0 ? ['/', '/boot/efi'] : ['/', '/boot/efi2'],
      partitions: [],
      smart: {
        model: null,
        serial: null,
        firmware: null,
        capacityBytes: null,
        protocol: 'NVMe',
        passed: true,
        failing: false,
        thresholdReached: false,
        errorLogEntries: 0,
        temperatureC: 49,
        powerOnHours: 2619,
        powerCycles: 960,
        wearPercent: 1,
        availableSpare: 100,
        availableSpareThreshold: 10,
        mediaErrors: 0,
        criticalWarning: 0,
        unsafeShutdowns: 163,
        dataWrittenBytes: 14_275_795_968_000,
        reallocatedSectors: null,
        pendingSectors: null,
        selfTestSupported: false,
        selfTestRunning: null,
        lastSelfTest: null,
      },
      health: 'ok' as const,
    })),
    esp: {
      mounts: [
        {
          mount: '/boot/efi',
          mounted: true,
          source: '/dev/nvme1n1p1',
          files: 12,
          bytes: 9_000_000,
          digest: 'a',
        },
        {
          mount: '/boot/efi2',
          mounted: true,
          source: '/dev/nvme0n1p1',
          files: 12,
          bytes: 9_000_000,
          digest: 'a',
        },
      ],
      inSync: true,
      differences: [],
      differenceCount: 0,
    },
    boot: {
      current: '000F',
      next: null,
      order: ['000F', '001A'],
      timeoutSeconds: 2,
      entries: [
        { number: '000F', active: true, label: 'Debian', partuuid: 'p1', disk: 'A' },
        { number: '001A', active: true, label: 'Debian (Reserve)', partuuid: 'p2', disk: 'B' },
      ],
    },
    reserveEntry: {
      number: '001A',
      active: true,
      label: 'Debian (Reserve)',
      partuuid: 'p2',
      disk: 'B',
    },
    checkedAt: '2026-09-24T20:00:00Z',
    ...over,
  };
}

export function backup(over: Partial<BackupStatus> = {}): BackupStatus {
  return {
    installed: true,
    initialized: true,
    repository: '/var/backups/helena/restic',
    passwordState: 'acknowledged',
    schedule: { frequency: 'hourly', time: '03:15' },
    retention: { hourly: 24, daily: 7, weekly: 4, monthly: 12 },
    checkWeekly: true,
    restoreTestMonthly: true,
    running: { backup: false, maintenance: false, 'restore-test': false },
    next: { backup: null, maintenance: null, 'restore-test': null },
    last: {
      backup: {
        ok: true,
        finishedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        snapshot: 'f00dbeef',
      },
      maintenance: null,
      'restore-test': null,
    },
    targets: [],
    paths: ['/etc'],
    history: [],
    restores: [],
    ...over,
  };
}

export function power(over: Partial<PowerStatus> = {}): PowerStatus {
  return {
    available: { ec: true, os: true, ryzenadj: true, smuDriver: true },
    board: 'AXB35-02',
    profile: 'balanced',
    desired: { profile: 'balanced', fans: { mode: 'fixed', level: 5 } },
    ec: {
      powerMode: 'balanced',
      temperatureC: 55,
      temperatureMaxC: 71,
      fans: [
        { id: 'fan1', role: 'cpu', rpm: 4700, mode: 'fixed', level: 5 },
        { id: 'fan2', role: 'cpu', rpm: 4650, mode: 'fixed', level: 5 },
        { id: 'fan3', role: 'system', rpm: 3000, mode: 'fixed', level: 5 },
      ],
    },
    fans: { mode: 'fixed', level: 5 },
    os: { profile: 'balanced' },
    cpu: { driver: 'amd-pstate-epp', governor: 'powersave', epp: 'balance_performance' },
    ryzenadj: { available: true, stapmLimitW: 85, fastLimitW: 120, slowLimitW: 120 },
    profiles: {
      saver: {
        ec: 'quiet',
        os: 'power-saver',
        ecLimitsW: { stapm: 54, fast: 100, slow: 54 },
        override: null,
      },
      balanced: {
        ec: 'balanced',
        os: 'balanced',
        ecLimitsW: { stapm: 85, fast: 120, slow: 120 },
        override: null,
      },
      performance: {
        ec: 'performance',
        os: 'performance',
        ecLimitsW: { stapm: 120, fast: 140, slow: 120 },
        override: null,
      },
    },
    temperatures: [{ sensor: 'k10temp', id: 'hwmon3/temp1', label: 'Tctl', celsius: 57.5 }],
    cpuTemperatureC: 57.5,
    guard: { limit: 90, state: { active: false } },
    ...over,
  };
}
