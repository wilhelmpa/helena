"""Managed sudoers rule for the owner's Unix account."""

from __future__ import annotations

import os
import re
import stat
import tempfile

from .common import Host, HostError

RULE = b'wilhelmpa ALL=(ALL:ALL) NOPASSWD: ALL\n'
PATH = '/etc/sudoers.d/99-volition-owner-terminal'
LEGACY = '/etc/sudoers.d/90-wilhelmpa'
DISABLED = '/etc/sudoers.d/.99-volition-owner-terminal.disabled'


def _existing(host: Host) -> bytes | None:
    path = host.path(PATH)
    try:
        mode = os.lstat(path).st_mode
        if not stat.S_ISREG(mode):
            raise HostError('CheckFailed', 'owner sudoers path is not a regular file')
        with open(path, 'rb') as handle:
            value = handle.read(4096)
    except FileNotFoundError:
        return None
    if value != RULE:
        raise HostError('CheckFailed', 'owner sudoers rule was changed outside hostd')
    return value


def status(host: Host) -> dict:
    return {'enabled': _existing(host) is not None}


def set_enabled(host: Host, enabled: bool) -> dict:
    previous = _existing(host)
    if enabled == (previous is not None):
        return {'enabled': enabled}
    directory = host.path('/etc/sudoers.d')
    path = host.path(PATH)
    if not enabled:
        sources = ['/etc/sudoers'] + [
            f'/etc/sudoers.d/{name}' for name in host.listdir('/etc/sudoers.d')
            if name != os.path.basename(PATH) and not name.startswith('.')
        ]
        for source in sources:
            text = host.read(source) or ''
            if re.search(r'^\s*(?:wilhelmpa|%sudo)\s+.*NOPASSWD:\s*ALL\s*$', text, re.M):
                raise HostError('CheckFailed', 'another owner NOPASSWD rule must be removed first')
    if enabled:
        fd, temp = tempfile.mkstemp(prefix='.volition-sudo-', dir=directory)
        try:
            os.fchmod(fd, 0o440)
            with os.fdopen(fd, 'wb') as handle:
                handle.write(RULE)
            if host.run(['/usr/sbin/visudo', '-cf', temp]).returncode != 0:
                raise HostError('CheckFailed', 'owner sudoers rule failed validation')
            os.replace(temp, path)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
    else:
        os.unlink(path)
    if host.run(['/usr/sbin/visudo', '-c']).returncode != 0:
        if previous is None:
            os.unlink(path)
        else:
            with open(path, 'wb') as handle:
                handle.write(previous)
            os.chmod(path, 0o440)
        raise HostError('CheckFailed', 'sudoers validation failed; prior rule restored')
    if enabled:
        try:
            os.unlink(host.path(DISABLED))
        except FileNotFoundError:
            pass
    else:
        with open(host.path(DISABLED), 'w', encoding='ascii') as marker:
            marker.write('disabled by owner\n')
        os.chmod(host.path(DISABLED), 0o600)
    return {'enabled': enabled}
