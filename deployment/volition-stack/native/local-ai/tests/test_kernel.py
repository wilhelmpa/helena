"""kernel.sh against a fake root: GRUB's files, the ESPs and every system command are stubs,
so the test boot's plumbing can be checked without touching a machine.

    python3 -m unittest discover -s deployment/volition-stack/native/local-ai/tests
"""

import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / 'kernel.sh'
UUID = '7a3b588b-a269-457b-a281-67748156782a'
OLD = '6.12.107+deb13-amd64'
NEW = '7.1.8+deb13-amd64'


def entry(abi: str) -> str:
    return (
        f"\tmenuentry 'Debian GNU/Linux, with Linux {abi}' --class debian --class gnu-linux "
        f"$menuentry_id_option 'gnulinux-{abi}-advanced-{UUID}' {{\n"
        f"\t\tlinux\t/boot/vmlinuz-{abi} root=UUID={UUID} ro  panic=30 quiet\n\t}}\n"
        f"\tmenuentry 'Debian GNU/Linux, with Linux {abi} (recovery mode)' --class debian "
        f"$menuentry_id_option 'gnulinux-{abi}-recovery-{UUID}' {{\n\t}}\n"
    )


def grub_cfg(kernels: list[str]) -> str:
    return (
        "### BEGIN /etc/grub.d/00_header ###\n"
        f"menuentry 'Debian GNU/Linux' $menuentry_id_option 'gnulinux-simple-{UUID}' {{\n}}\n"
        f"submenu 'Advanced options for Debian GNU/Linux' $menuentry_id_option "
        f"'gnulinux-advanced-{UUID}' {{\n"
        + ''.join(entry(k) for k in kernels)
        + "}\n"
    )


STUBS = {
    # The environment block as key=value lines (the stub's own format).
    'grub-editenv': r'''#!/bin/sh
file=$1; shift
touch "$file"
case "$1" in
  list) cat "$file" ;;
  unset) grep -v "^$2=" "$file" > "$file.tmp" || true; mv "$file.tmp" "$file" ;;
  set) shift; for kv in "$@"; do k=${kv%%=*}; grep -v "^$k=" "$file" > "$file.tmp" || true; echo "$kv" >> "$file.tmp"; mv "$file.tmp" "$file"; done ;;
esac
''',
    'grub-set-default': r'''#!/bin/sh
f="$HELENA_KERNEL_ROOT/boot/grub/grubenv"; touch "$f"
grep -v '^saved_entry=' "$f" > "$f.tmp" || true; echo "saved_entry=$1" >> "$f.tmp"; mv "$f.tmp" "$f"
echo "grub-set-default $1" >> "$LOG"
''',
    'uname': '#!/bin/sh\necho "$KERNEL_RUNNING"\n',
    'update-grub': '#!/bin/sh\necho update-grub >> "$LOG"\n',
    'apt-get': '#!/bin/sh\necho "apt-get $*" >> "$LOG"\n',
    'rsync': '#!/bin/sh\necho "rsync $*" >> "$LOG"\n',
    'dpkg-query': '#!/bin/sh\nfor a; do last=$a; done\ncase "$last" in firmware-amd-graphics) echo 20250410-2 ;; esac\n',
    'findmnt': '#!/bin/sh\ncase "$*" in *SOURCE*) echo /dev/nvme0n1p1 ;; *UUID*) echo ' + UUID + ' ;; esac\n',
    'lsblk': '#!/bin/sh\necho nvme0n1\n',
    # efibootmgr: entries in $EFI_STATE as "NUM LABEL" lines; BootNext in $EFI_STATE.next.
    'efibootmgr': r'''#!/bin/sh
echo "efibootmgr $*" >> "$LOG"
state=$EFI_STATE; touch "$state"
label=; create=0; delete=0; num=; next=
while [ $# -gt 0 ]; do
  case "$1" in
    -C) create=1 ;; -B) delete=1 ;; -b) num=$2; shift ;; -L) label=$2; shift ;;
    -n) echo "$2" > "$state.next"; shift ;; -N) rm -f "$state.next" ;;
    -d|-p|-l) shift ;; -q) ;;
  esac
  shift
done
if [ $create = 1 ]; then echo "000C $label" >> "$state"; exit 0; fi
if [ $delete = 1 ]; then grep -v "^$num " "$state" > "$state.tmp" || true; mv "$state.tmp" "$state"; exit 0; fi
echo "BootCurrent: 000F"
[ -f "$state.next" ] && echo "BootNext: $(cat "$state.next")"
echo "BootOrder: 000F,001A"
echo "Boot000F* Debian	HD(1,GPT,...)/File(\EFI\helena-raid\shimx64.efi)"
while read -r n l; do echo "Boot$n* $l"; done < "$state"
''',
}


class KernelScriptTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='kernel-sh-'))
        self.bin = self.root / 'stub-bin'
        self.bin.mkdir()
        for name, body in STUBS.items():
            path = self.bin / name
            path.write_text(body)
            path.chmod(path.stat().st_mode | stat.S_IXUSR)
        (self.root / 'etc/default').mkdir(parents=True)
        (self.root / 'etc/default/grub').write_text(
            'GRUB_DEFAULT=0\nGRUB_TIMEOUT=3\nGRUB_CMDLINE_LINUX=" panic=30"\n')
        (self.root / 'boot/grub').mkdir(parents=True)
        self.write_cfg([OLD])
        (self.root / 'boot/grub/grubenv').write_text('')
        for name in (f'vmlinuz-{OLD}',):
            (self.root / 'boot' / name).write_text('')
        loader = self.root / 'boot/efi/EFI/helena-raid'
        loader.mkdir(parents=True)
        for name in ('shimx64.efi', 'grubx64.efi', 'mmx64.efi'):
            (loader / name).write_text(name)
        (loader / 'grub.cfg').write_text(
            f"search.fs_uuid {UUID} root mduuid/3a9a9cf25e0c71773502594f9df09b21 \n"
            "set prefix=($root)'/boot/grub'\nconfigfile $prefix/grub.cfg\n")
        (self.root / 'boot/efi2/EFI').mkdir(parents=True)
        (self.root / 'sys/class/block/nvme0n1p1').mkdir(parents=True)
        (self.root / 'sys/class/block/nvme0n1p1/partition').write_text('1\n')
        (self.root / 'mdstat').write_text(
            'md127 : active raid1 nvme0n1p2[2] nvme1n1p2[0]\n      1951284288 blocks [2/2] [UU]\n')
        self.log = self.root / 'log'
        self.log.write_text('')

    def tearDown(self):
        shutil.rmtree(self.root)

    def write_cfg(self, kernels):
        (self.root / 'boot/grub/grub.cfg').write_text(grub_cfg(kernels))

    def run_script(self, *args, running=OLD, check=True):
        env = {
            **os.environ,
            'PATH': f'{self.bin}:{os.environ["PATH"]}',
            'HELENA_KERNEL_ROOT': str(self.root),
            'HELENA_SYS': str(self.root / 'sys'),
            'HELENA_MDSTAT': str(self.root / 'mdstat'),
            'KERNEL_RUNNING': running,
            'LOG': str(self.log),
            'EFI_STATE': str(self.root / 'efi-state'),
        }
        result = subprocess.run(['sh', str(SCRIPT), *args], env=env, capture_output=True, text=True)
        if check and result.returncode != 0:
            self.fail(f'kernel.sh {args} failed ({result.returncode}):\n{result.stdout}\n{result.stderr}')
        return result

    def env(self) -> dict[str, str]:
        lines = (self.root / 'boot/grub/grubenv').read_text().splitlines()
        return dict(line.split('=', 1) for line in lines if '=' in line)

    def test_prepare_pins_grub_to_the_running_kernel_and_backports_low(self):
        self.run_script('prepare')
        self.assertIn('GRUB_DEFAULT=saved', (self.root / 'etc/default/grub').read_text())
        self.assertEqual(self.env()['saved_entry'],
                         f'gnulinux-advanced-{UUID}>gnulinux-{OLD}-advanced-{UUID}')
        prefs = (self.root / 'etc/apt/preferences.d/helena-backports').read_text()
        self.assertIn('Pin: release n=trixie-backports\nPin-Priority: 1\n', prefs)
        self.assertIn('Package: firmware-amd-graphics\nPin: version 20260810-1~bpo13+1\nPin-Priority: 1001', prefs)
        sources = (self.root / 'etc/apt/sources.list.d/helena-backports.sources').read_text()
        self.assertIn('Components: main contrib non-free-firmware', sources)
        self.assertTrue((self.root / 'etc/default/grub.pre-helena-kernel').exists())

    def test_dry_run_changes_nothing(self):
        result = self.run_script('--dry-run', 'prepare')
        self.assertIn('would: grub-set-default', result.stdout)
        self.assertIn('GRUB_DEFAULT=0', (self.root / 'etc/default/grub').read_text())
        self.assertEqual(self.env(), {})
        self.assertFalse((self.root / 'etc/apt/preferences.d/helena-backports').exists())

    def test_install_takes_exact_versions_and_refuses_before_prepare(self):
        refused = self.run_script('install', check=False)
        self.assertNotEqual(refused.returncode, 0)
        self.run_script('prepare')
        # The kernel's postinst would run update-grub; the fixture adds the new entry itself.
        self.write_cfg([NEW, OLD])
        self.run_script('install')
        log = self.log.read_text()
        self.assertIn('-t trixie-backports', log)
        self.assertIn(f'linux-image-{NEW}=7.1.8-1~bpo13+1', log)
        self.assertIn(f'linux-headers-{NEW}=7.1.8-1~bpo13+1', log)
        self.assertIn('firmware-amd-graphics=20260810-1~bpo13+1', log)
        self.assertIn('apt-get download firmware-amd-graphics=20250410-2', log)
        # The default still is the running kernel.
        self.assertIn(f'gnulinux-{OLD}-advanced', self.env()['saved_entry'])

    def test_trial_arms_bootnext_to_a_loader_outside_bootorder(self):
        self.run_script('prepare')
        self.write_cfg([NEW, OLD])
        self.run_script('trial')
        cfg = (self.root / 'boot/efi/EFI/helena-ktest/grub.cfg').read_text()
        self.assertIn(f'search.fs_uuid {UUID}', cfg)
        self.assertIn('source $prefix/grub.cfg', cfg)
        self.assertIn(f"set default='gnulinux-advanced-{UUID}>gnulinux-{NEW}-advanced-{UUID}'", cfg)
        self.assertNotIn('next_entry', cfg)
        log = self.log.read_text()
        self.assertIn('-C -d /dev/nvme0n1 -p 1 -L Debian (Kernel-Test)', log)
        self.assertIn('efibootmgr -q -n 000C', log)
        # GRUB's own default is untouched: a reset lands on the old kernel.
        self.assertIn(f'gnulinux-{OLD}-advanced', self.env()['saved_entry'])
        self.assertNotIn('next_entry', self.env())
        self.assertTrue((self.root / 'boot/efi/EFI/helena-ktest/shimx64.efi').exists())

    def test_rollback_restores_the_old_default_and_removes_the_trial(self):
        self.run_script('prepare')
        self.write_cfg([NEW, OLD])
        (self.root / 'boot' / f'vmlinuz-{NEW}').write_text('')
        self.run_script('trial')
        grub = self.root / 'boot/grub/grubenv'
        grub.write_text(grub.read_text() + f'next_entry=gnulinux-{NEW}\n')
        self.run_script('rollback', running=NEW)
        self.assertIn(f'gnulinux-{OLD}-advanced', self.env()['saved_entry'])
        self.assertNotIn('next_entry', self.env())
        self.assertFalse((self.root / 'boot/efi/EFI/helena-ktest').exists())
        self.assertIn('efibootmgr -q -b 000C -B', self.log.read_text())

    def test_promote_needs_the_new_kernel_running_and_a_passed_verify(self):
        self.run_script('prepare')
        self.write_cfg([NEW, OLD])
        self.assertNotEqual(self.run_script('promote', check=False).returncode, 0)
        self.assertNotEqual(self.run_script('promote', running=NEW, check=False).returncode, 0)
        state = self.root / 'var/lib/helena-ai/kernel'
        state.mkdir(parents=True, exist_ok=True)
        (state / 'verify-20260925-000000.txt').write_text('RESULT: passed. Next\n')
        self.run_script('promote', running=NEW)
        self.assertIn(f'gnulinux-{NEW}-advanced', self.env()['saved_entry'])

    def test_status_warns_about_a_next_entry_grub_cannot_clear(self):
        (self.root / 'boot/grub/grubenv').write_text('next_entry=x\n')
        result = self.run_script('status')
        self.assertIn('GRUB cannot clear it on the RAID', result.stdout)
        self.assertIn('[UU]', result.stdout)


if __name__ == '__main__':
    unittest.main()
