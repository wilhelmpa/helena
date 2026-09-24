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
const LOADER = String.raw`\EFI\helena-raid\shimx64.efi`;

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
  // The first disk's entry is "Debian" and boots first; the second's is the reserve, created
  // outside the boot order and added after "Debian".
  const reserve = letter !== 'A';
  const bootLabel = reserve ? 'Debian (Reserve)' : 'Debian';
  const stale = (storage.boot?.entries ?? []).filter(
    (entry) => entry.label === bootLabel && entry.disk === null,
  );
  const debian = (storage.boot?.entries ?? []).find((entry) => entry.label === 'Debian');
  const boot = [
    ...stale.map((entry) => `sudo efibootmgr --bootnum ${entry.number} --delete-bootnum`),
    `sudo efibootmgr ${reserve ? '--create-only' : '--create'} --disk ${target} --part 1 --label "${bootLabel}" --loader '${LOADER}'`,
    ...(reserve && debian ? [`sudo efibootmgr --bootorder ${debian.number},<neu>`] : []),
  ].join(' && ');
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
