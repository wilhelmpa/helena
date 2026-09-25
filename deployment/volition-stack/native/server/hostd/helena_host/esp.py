"""The copy of the first EFI system partition onto the second after every package change
(apt's DPkg::Post-Invoke in /etc/apt/apt.conf.d/99helena-esp-sync runs
`helena-hostd esp-sync`). The firmware entry "Debian (Reserve)" boots from the copy, so a
copy from a broken source is worse than none. It runs only when:

- both ESPs are mounted, as vfat, and are two different file systems;
- the source holds, for every loader folder of this layout found on either ESP (the
  configured one, EFI/debian, and the old one, EFI/helena-raid), the shim and its grub.cfg,
  not empty — so a copy never removes a loader the mirror still starts;
- every file of the source reads back in full (a disk falling off the bus answers EIO);

and it counts only when rsync exits 0 and every file of the copy equals its source. A copy
that did not run leaves the mirror as it was (`--delete` never runs from a source that failed
a check). The outcome is kept in /var/lib/helena/hostd/esp-sync.json for the health overview,
and a change of it (skipped, failed, working again) is an event."""

from __future__ import annotations

import hashlib
import json
import os

from . import audit, events
from .boot import layout_in_use, loader_files, loader_relative, loaders
from .common import Host, atomic_write_json, clip, file_lock, iso, json_load_file

STATE_FILE = 'esp-sync.json'
CHUNK = 1 << 20


def state_path(state_dir: str) -> str:
    return os.path.join(state_dir, STATE_FILE)


def read_state(state_dir: str) -> dict | None:
    """The last outcome, as StorageStatus shows it (esp.sync): without the digests."""
    data = json_load_file(state_path(state_dir), None)
    if not isinstance(data, dict) or data.get('state') not in ('ok', 'skipped', 'failed'):
        return None
    return {key: data.get(key) for key in ('state', 'reason', 'at', 'mount', 'pending', 'syncedAt', 'detail')}


def _mounted(host: Host, mount: str) -> dict | None:
    findmnt = host.which('findmnt')
    if not findmnt:
        return None
    result = host.run([findmnt, '-J', '-n', '-o', 'TARGET,SOURCE,FSTYPE', '--mountpoint', mount], timeout=10)
    if result.returncode != 0:
        return None
    try:
        found = json.loads(result.stdout).get('filesystems') or []
    except ValueError:
        return None
    return found[0] if found else None


def file_hashes(root: str) -> dict[str, str]:
    """sha256 of every file under `root`, read in full; raises OSError when one does not read."""
    hashes: dict[str, str] = {}
    for directory, dirnames, filenames in os.walk(root, onerror=_raise):
        dirnames.sort()
        for filename in sorted(filenames):
            full = os.path.join(directory, filename)
            digest = hashlib.sha256()
            with open(full, 'rb') as handle:
                while True:
                    chunk = handle.read(CHUNK)
                    if not chunk:
                        break
                    digest.update(chunk)
            hashes[os.path.relpath(full, root)] = digest.hexdigest()
    return hashes


def _raise(error: OSError) -> None:
    raise error


def tree_digest(hashes: dict[str, str]) -> str:
    return hashlib.sha256(json.dumps(sorted(hashes.items())).encode()).hexdigest()


def sync(host: Host, config, *, dry_run: bool = False, log=lambda message: None,
         trigger: str = 'console') -> dict:
    storage = config.storage
    mounts = list(storage.get('espMounts') or [])
    current, legacy = loaders(storage)
    state_dir = config.state_dir
    if not layout_in_use(host, storage):
        # Not this machine's layout (no EFI/helena-raid on either ESP): nothing to mirror, and
        # nothing recorded, so Helena shows no line for it.
        return {'state': 'skipped', 'reason': 'notInUse', 'at': iso(host.now()), 'mount': None,
                'detail': None, 'trigger': trigger}
    with file_lock(os.path.join(state_dir, 'esp-sync.lock')):
        previous = json_load_file(state_path(state_dir), None)
        previous = previous if isinstance(previous, dict) else {}

        def finish(state: str, reason: str | None = None, *, mount: str | None = None,
                   detail: str | None = None, source_digest: str | None = None, extra: dict | None = None) -> dict:
            outcome = {'state': state, 'reason': reason, 'at': iso(host.now()), 'mount': mount,
                       'detail': detail, 'trigger': trigger, **(extra or {})}
            if dry_run:
                return {**outcome, 'dryRun': True}
            synced_digest = previous.get('syncedDigest')
            if state == 'ok':
                outcome.update(pending=False, syncedAt=outcome['at'], syncedDigest=source_digest)
            else:
                # Did the mirror miss anything? Only knowable when the source is readable and
                # a copy of it was verified before.
                outcome.update(pending=not (source_digest and source_digest == synced_digest),
                               syncedAt=previous.get('syncedAt'), syncedDigest=synced_digest)
            os.makedirs(state_dir, mode=0o700, exist_ok=True)
            atomic_write_json(state_path(state_dir), outcome)
            _report(host, state_dir, previous, outcome, log)
            return {key: value for key, value in outcome.items() if key != 'syncedDigest'}

        if len(mounts) < 2:
            return finish('skipped', 'notConfigured')
        source, target = mounts[0], mounts[1]
        found = {mount: _mounted(host, mount) for mount in (source, target)}
        for mount in (source, target):
            if not found[mount]:
                return finish('skipped', 'notMounted', mount=mount,
                              source_digest=_digest_or_none(host, source) if mount == target else None)
            if found[mount].get('fstype') != 'vfat':
                return finish('skipped', 'notVfat', mount=mount)
        source_dir, target_dir = host.path(source), host.path(target)
        # One file system seen twice (a bind mount, one device in both fstab lines) would copy
        # onto itself and --delete nothing but hide that the mirror is missing.
        if found[source].get('source') and found[source].get('source') == found[target].get('source'):
            return finish('skipped', 'sameDevice', mount=target)
        try:
            first, second = os.stat(source_dir), os.stat(target_dir)
        except OSError:
            return finish('skipped', 'notMounted', mount=source)
        if (first.st_dev, first.st_ino) == (second.st_dev, second.st_ino):
            return finish('skipped', 'sameDevice', mount=target)
        required = [relative for loader in (current, *legacy)
                    if any(os.path.isdir(os.path.join(root, os.path.dirname(loader_relative(loader))))
                           for root in (source_dir, target_dir))
                    for relative in loader_files(loader)]
        if not required:
            return finish('failed', 'sourceIncomplete', mount=source, detail=loader_files(current)[0])
        for relative in required:
            try:
                if os.path.getsize(os.path.join(source_dir, relative)) <= 0:
                    return finish('failed', 'sourceIncomplete', mount=source, detail=relative)
            except OSError:
                return finish('failed', 'sourceIncomplete', mount=source, detail=relative)
        try:
            hashes = file_hashes(source_dir)
        except OSError as error:
            return finish('failed', 'readFailed', mount=source,
                          detail=clip(os.path.relpath(error.filename, source_dir) if error.filename else None, 120))
        digest = tree_digest(hashes)
        if dry_run:
            return finish('ready', mount=target, extra={'files': len(hashes)})
        rsync = host.which('rsync')
        if not rsync:
            return finish('failed', 'noRsync', mount=target, source_digest=digest)
        # -a keeps the times (vfat stores them in 2 s steps: --modify-window=1), --delete makes
        # the mirror equal. Only reached with a mounted, complete, readable source.
        copied = host.run([rsync, '-a', '--delete', '--modify-window=1', '--itemize-changes',
                           source_dir + '/', target_dir + '/'], timeout=600)
        changed = sum(1 for line in copied.stdout.splitlines() if line.strip())
        if copied.returncode != 0:
            log(f'esp-sync: rsync exited {copied.returncode}: {clip(copied.stderr, 300)}')
            return finish('failed', 'rsyncFailed', mount=target, detail=f'rsync {copied.returncode}',
                          source_digest=digest, extra={'changed': changed})
        try:
            mirrored = file_hashes(target_dir)
        except OSError:
            return finish('failed', 'verifyFailed', mount=target, source_digest=digest, extra={'changed': changed})
        if mirrored != hashes:
            different = sorted(set(hashes) ^ set(mirrored)
                               | {path for path in set(hashes) & set(mirrored) if hashes[path] != mirrored[path]})
            return finish('failed', 'verifyFailed', mount=target, detail=clip(different[0], 120) if different else None,
                          source_digest=digest, extra={'changed': changed})
        return finish('ok', mount=target, source_digest=digest, extra={'files': len(hashes), 'changed': changed})


def _digest_or_none(host: Host, mount: str) -> str | None:
    """The source's digest when it is mounted and reads, for "did the mirror miss anything"."""
    if not _mounted(host, mount):
        return None
    try:
        return tree_digest(file_hashes(host.path(mount)))
    except OSError:
        return None


def _report(host: Host, state_dir: str, previous: dict, outcome: dict, log) -> None:
    """Journal every run; an event only when the outcome changes (a run per dpkg call would
    fill the list while a disk is out)."""
    state, reason = outcome['state'], outcome.get('reason')
    before, before_reason = previous.get('state'), previous.get('reason')
    log(f"esp-sync: {state}{f' ({reason})' if reason else ''} {outcome.get('mount') or ''}".rstrip())
    message = ' '.join(part for part in (reason, outcome.get('detail')) if part) or None
    if state == 'failed' and (before != 'failed' or before_reason != reason):
        events.record(state_dir, source='esp', severity='critical', code='EspSyncFailed',
                      device=outcome.get('mount'), message=message, at=host.now())
    elif state == 'skipped' and outcome.get('pending') and (before != 'skipped' or not previous.get('pending')):
        events.record(state_dir, source='esp', severity='warning', code='EspSyncSkipped',
                      device=outcome.get('mount'), message=message, at=host.now())
    elif state == 'ok' and (before == 'failed' or (before == 'skipped' and previous.get('pending'))):
        events.record(state_dir, source='esp', severity='info', code='EspSyncRecovered',
                      device=outcome.get('mount'), message=None, at=host.now())
    # The audit log holds what changed the machine: a copy that wrote files, or one that
    # failed after rsync may have written some.
    if outcome.get('changed') or reason in ('rsyncFailed', 'verifyFailed'):
        audit.append(state_dir, {'at': outcome['at'], 'caller': 'root', 'actor': f"esp-sync ({outcome['trigger']})",
                                 'method': 'EspSync', 'params': {'target': outcome.get('mount')},
                                 'ok': state == 'ok', 'changed': outcome.get('changed') or 0,
                                 **({'error': message} if message and state != 'ok' else {})}, log)
