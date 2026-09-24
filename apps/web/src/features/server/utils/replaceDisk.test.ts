import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StorageStatus } from '@/lib/api/endpoints/server';
import { isDiskDevice, partitionOf, replacementPlan } from './replaceDisk';

const part = (kname: string, partlabel: string, mountpoints: string[] = []) => ({
  kname,
  partlabel,
  partuuid: `${kname}-uuid`,
  fstype: null,
  sizeBytes: 1_000_000_000,
  mountpoints,
});

function storage(): StorageStatus {
  return {
    arrays: [
      {
        kname: 'md127',
        name: 'helena-root',
        level: 'raid1',
        state: 'clean',
        raidDisks: 2,
        degraded: 1,
        syncAction: 'idle',
        syncPercent: null,
        syncSpeedKiB: null,
        syncRemainingSeconds: null,
        mismatchCount: 0,
        members: [
          { device: 'nvme1n1p2', states: ['in_sync'], slot: 0 },
          { device: 'nvme0n1p2', states: ['faulty'], slot: 1 },
        ],
        health: 'critical',
      },
    ],
    disks: [
      {
        kname: 'nvme1n1',
        letter: 'A',
        model: 'Samsung',
        serial: 'S1',
        sizeBytes: 2_000_000_000_000,
        transport: 'nvme',
        arrays: ['helena-root'],
        mountpoints: ['/', '/boot/efi'],
        partitions: [
          part('nvme1n1p1', 'HELENA-EFI-A', ['/boot/efi']),
          part('nvme1n1p2', 'HELENA-RAID-A'),
        ],
        smart: null,
        health: 'ok',
      },
      {
        kname: 'nvme0n1',
        letter: 'B',
        model: 'Kingston',
        serial: 'K1',
        sizeBytes: 2_048_000_000_000,
        transport: 'nvme',
        arrays: ['helena-root'],
        mountpoints: ['/boot/efi2'],
        partitions: [
          part('nvme0n1p1', 'HELENA-EFI-B', ['/boot/efi2']),
          part('nvme0n1p2', 'HELENA-RAID-B'),
        ],
        smart: null,
        health: 'critical',
      },
    ],
    esp: {
      mounts: [
        { mount: '/boot/efi', mounted: true, source: null, files: 1, bytes: 1, digest: 'a' },
        { mount: '/boot/efi2', mounted: true, source: null, files: 1, bytes: 1, digest: 'a' },
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
        { number: '000F', active: true, label: 'Debian', partuuid: 'x', disk: 'A' },
        { number: '001A', active: true, label: 'Debian (Reserve)', partuuid: 'gone', disk: null },
      ],
    },
    reserveEntry: null,
    checkedAt: '2026-09-24T20:00:00Z',
  };
}

describe('replacing a mirror disk', () => {
  it('fills the commands in from the machine', () => {
    const plan = replacementPlan(storage(), 'nvme0n1', '/dev/nvme2n1')!;
    assert.equal(plan.letter, 'B');
    assert.equal(plan.healthyLetter, 'A');
    assert.equal(plan.oldPartition, 'nvme0n1p2');
    assert.equal(plan.espMount, '/boot/efi2');
    assert.equal(plan.otherEspMount, '/boot/efi');
    assert.equal(plan.bootLabel, 'Debian (Reserve)');
    assert.equal(
      plan.commands.remove,
      'sudo mdadm --manage /dev/md/helena-root --fail /dev/nvme0n1p2 --remove /dev/nvme0n1p2',
    );
    assert.match(
      plan.commands.partition,
      /^sudo sgdisk --replicate=\/dev\/nvme2n1 \/dev\/nvme1n1 /,
    );
    assert.match(plan.commands.partition, /HELENA-RAID-B/);
    assert.match(plan.commands.esp, /mkfs\.vfat -F 32 -n HELENAEFIB \/dev\/nvme2n1p1/);
    assert.match(plan.commands.esp, /rsync -a --delete \/boot\/efi\/ \/boot\/efi2\//);
    assert.equal(plan.commands.add, 'sudo mdadm --manage /dev/md/helena-root --add /dev/nvme2n1p2');
    // The orphaned reserve entry goes, the new one stays out of the order until placed after Debian.
    assert.match(plan.commands.boot, /--bootnum 001A --delete-bootnum/);
    assert.match(
      plan.commands.boot,
      /--create-only --disk \/dev\/nvme2n1 --part 1 --label "Debian \(Reserve\)"/,
    );
    assert.match(plan.commands.boot, /--bootorder 000F,<neu>/);
  });

  it('writes a placeholder until the new device is named, and refuses partitions', () => {
    const plan = replacementPlan(storage(), 'nvme0n1', '/dev/nvme2n1p1')!;
    assert.equal(plan.newDeviceValid, false);
    assert.match(plan.commands.add, /<neu>/);
    assert.equal(isDiskDevice('/dev/sda'), true);
    assert.equal(isDiskDevice('/dev/sda; rm -rf /'), false);
    assert.equal(partitionOf('/dev/sda', 2), '/dev/sda2');
    assert.equal(partitionOf('/dev/nvme0n1', 1), '/dev/nvme0n1p1');
  });

  it('has no plan without a healthy second disk', () => {
    const broken = storage();
    broken.arrays[0]!.members = [{ device: 'nvme0n1p2', states: ['faulty'], slot: 1 }];
    assert.equal(replacementPlan(broken, 'nvme0n1', '/dev/nvme2n1'), null);
  });
});
