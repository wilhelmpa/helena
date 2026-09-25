import type { StorageStatus } from '@/lib/api/endpoints/server';

// The commands of "Platte ersetzen", filled in from this machine: the array, the disk that
// stays, its partition layout, the EFI mounts and the firmware entries. The owner runs them
// as root; Helena only writes them down.

export interface ReplacementPlan {
  letter: string;
  healthyLetter: string;
  arrayName: string;
  oldPartition: string | null;
  minimumBytes: number;
  espMount: string;
  otherEspMount: string;
  bootLabel: string;
  newDeviceValid: boolean;
  commands: { remove: string; partition: string; esp: string; add: string; boot: string };
}

const DEVICE = /^\/dev\/(nvme\d+n\d+|sd[a-z]{1,2}|vd[a-z]{1,2})$/;
const HOSTD_DIR = '/usr/local/lib/helena/hostd';

export function isDiskDevice(value: string): boolean {
  return DEVICE.test(value);
}

// nvme0n1 → nvme0n1p1, sda → sda1.
export function partitionOf(device: string, number: number): string {
  return /\d$/.test(device) ? `${device}p${number}` : `${device}${number}`;
}

export function replacementPlan(
  storage: StorageStatus,
  replaced: string,
  newDevice: string,
): ReplacementPlan | null {
  const disk = storage.disks.find((candidate) => candidate.kname === replaced);
  if (!disk) return null;
  const partsOf = (kname: string) =>
    storage.disks.find((candidate) => candidate.kname === kname)?.partitions ?? [];
  const array =
    storage.arrays.find((candidate) =>
      candidate.members.some((member) =>
        disk.partitions.some((part) => part.kname === member.device),
      ),
    ) ?? storage.arrays[0];
  if (!array) return null;
  const healthy = storage.disks.find(
    (candidate) =>
      candidate.kname !== disk.kname &&
      array.members.some(
        (member) =>
          member.states.includes('in_sync') &&
          candidate.partitions.some((part) => part.kname === member.device),
      ),
  );
  if (!healthy) return null;
  const oldPartition =
    array.members.find((member) => disk.partitions.some((part) => part.kname === member.device))
      ?.device ?? null;
  const espMounts = storage.esp.mounts.map((mount) => mount.mount);
  const letter = disk.letter ?? '?';
  const healthyLetter = healthy.letter ?? healthy.kname;
  // The disk's own ESP mount, or by letter (A: the first, B: the second).
  const ownEsp =
    disk.partitions
      .flatMap((part) => part.mountpoints)
      .find((mount) => espMounts.includes(mount)) ??
    espMounts[letter === 'A' ? 0 : 1] ??
    '/boot/efi';
  const otherEsp = espMounts.find((mount) => mount !== ownEsp) ?? '/boot/efi';
  const valid = isDiskDevice(newDevice);
  const target = valid ? newDevice : '/dev/<neu>';
  const source = `/dev/${healthy.kname}`;
  const p1 = valid ? partitionOf(newDevice, 1) : `${target}p1`;
  const p2 = valid ? partitionOf(newDevice, 2) : `${target}p2`;
  const md = `/dev/md/${array.name}`;
  // The first disk's entry is "Debian", the second's "Debian (Reserve)". The host helper's
  // boot repair creates the entry on the new ESP, reads it back, then removes the orphaned one
  // and puts Debian, Reserve first (it also runs at every boot).
  const bootLabel = letter !== 'A' ? 'Debian (Reserve)' : 'Debian';
  const boot = `sudo ${HOSTD_DIR}/helena-hostd boot-repair`;
  return {
    letter,
    healthyLetter,
    arrayName: array.name,
    oldPartition,
    minimumBytes: partsOf(healthy.kname).reduce((sum, part) => sum + (part.sizeBytes ?? 0), 0),
    espMount: ownEsp,
    otherEspMount: otherEsp,
    bootLabel,
    newDeviceValid: valid,
    commands: {
      remove: oldPartition
        ? `sudo mdadm --manage ${md} --fail /dev/${oldPartition} --remove /dev/${oldPartition}`
        : '',
      partition: [
        `sudo sgdisk --replicate=${target} ${source}`,
        `sudo sgdisk --randomize-guids ${target}`,
        `sudo sgdisk --change-name=1:HELENA-EFI-${letter} --change-name=2:HELENA-RAID-${letter} ${target}`,
        `sudo partx -u ${target}`,
      ].join(' && '),
      esp: [
        `sudo mkfs.vfat -F 32 -n HELENAEFI${letter} ${p1}`,
        `sudo sed -i "s|^UUID=[A-F0-9-]* ${ownEsp} |UUID=$(sudo blkid -s UUID -o value ${p1}) ${ownEsp} |" /etc/fstab`,
        'sudo systemctl daemon-reload',
        `sudo mount ${ownEsp}`,
        `sudo rsync -a --delete ${otherEsp}/ ${ownEsp}/`,
      ].join(' && '),
      add: `sudo mdadm --manage ${md} --add ${p2}`,
      boot,
    },
  };
}

// "Nur verschwunden?": a disk that fell off the bus (the kernel's "controller is down", the
// mirror without it, lsblk without it) is often not broken; a cold start brings it back. The
// commands name the partitions by their GPT labels (HELENA-RAID-A, HELENA-EFI-B), which stay
// the same when the kernel numbers the disks differently after the restart.

export interface RecoveryPlan {
  letter: string;
  // The disk is not on the bus now (fewer lettered disks than ESP mounts).
  missing: boolean;
  espMount: string;
  commands: {
    poweroff: string;
    smart: string;
    readd: string;
    esp: string;
    bootCheck: string;
    bootRepair: string;
    espCopy: string;
  };
}

export function recoveryPlan(storage: StorageStatus, selected: string): RecoveryPlan {
  const espMounts = storage.esp.mounts.map((mount) => mount.mount);
  // A: the first ESP's disk, B: the second's (as in the plan above).
  const expected = espMounts.map((_, index) => String.fromCharCode(65 + index));
  const present = new Set(storage.disks.map((disk) => disk.letter).filter(Boolean));
  const gone = expected.find((letter) => !present.has(letter));
  const chosen = storage.disks.find((disk) => disk.kname === selected)?.letter ?? undefined;
  const letter = gone ?? chosen ?? expected[expected.length - 1] ?? 'B';
  const espMount = espMounts[letter.charCodeAt(0) - 65] ?? '/boot/efi';
  const array = storage.arrays[0]?.name ?? 'helena-root';
  const efi = `/dev/disk/by-partlabel/HELENA-EFI-${letter}`;
  const raid = `/dev/disk/by-partlabel/HELENA-RAID-${letter}`;
  return {
    letter,
    missing: gone !== undefined,
    espMount,
    commands: {
      poweroff: 'sudo systemctl poweroff',
      smart: `sudo smartctl -a /dev/$(lsblk -dno PKNAME ${efi})`,
      readd: `sudo mdadm --manage /dev/md/${array} --re-add ${raid}`,
      esp: `mountpoint -q ${espMount} || { sudo fsck.vfat -a ${efi} && sudo mount ${espMount}; }`,
      bootCheck: `sudo ${HOSTD_DIR}/helena-hostd boot-repair --dry-run`,
      bootRepair: `sudo ${HOSTD_DIR}/helena-hostd boot-repair`,
      espCopy: `sudo ${HOSTD_DIR}/helena-esp-sync`,
    },
  };
}
