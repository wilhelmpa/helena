"""The preview port range is private; a browser's systemd cgroup selects its project."""

from __future__ import annotations

import asyncio
from pathlib import Path
import pwd

from isolation_common import IsolationError, valid_slug
from helena_previews import PORT_BASE, SLOTS, ports


CGROUP_ROOT = Path('/sys/fs/cgroup')
BROWSER_SLICE = 'system.slice/system-volition\\x2dproject\\x2dbrowser\\x2dchromium.slice'


def browser_groups(config) -> list[tuple[str, str, int, int]]:
    values = []
    for directory in sorted((CGROUP_ROOT / BROWSER_SLICE).glob('volition-project-browser-chromium@*.service')):
        slug = directory.name.removeprefix('volition-project-browser-chromium@').removesuffix('.service')
        if not valid_slug(slug):
            continue
        try:
            uid = pwd.getpwnam(config.user_prefix + slug).pw_uid
            if not config.uid_range[0] <= uid <= config.uid_range[1]:
                continue
            values.append((slug, str(directory.relative_to(CGROUP_ROOT)), directory.stat().st_ino, uid))
        except (KeyError, OSError):
            continue
    return values


def rules(config, groups, browser_uid: int, nginx_uid: int) -> str:
    end = PORT_BASE + (config.uid_range[1] - config.uid_range[0] + 1) * SLOTS - 1
    lines = [
        'add table inet helena_previews',
        'flush table inet helena_previews',
        'table inet helena_previews {',
        ' chain incoming { type filter hook input priority -5; policy accept;',
        f'  iifname != "lo" tcp dport {PORT_BASE}-{end} reject with tcp reset comment "helena:preview-no-lan"',
        ' }',
        ' chain outgoing { type filter hook output priority -5; policy accept;',
        f'  ip daddr 127.0.0.1 tcp dport {PORT_BASE}-{end} jump allowed',
        ' }',
        ' chain allowed {',
        f'  meta skuid {{ 0, {nginx_uid} }} accept',
    ]
    for _slug, path, _inode, uid in groups:
        # nft's quoted cgroup path retains systemd's literal backslash-x escape sequences.
        level = len(path.split('/'))
        assigned = ports(uid, config.uid_range[0])
        lines.append(f'  meta skuid {browser_uid} tcp dport {assigned.start}-{assigned.stop - 1} '
                     f'socket cgroupv2 level {level} "{path}" accept')
    lines += ['  reject with tcp reset comment "helena:preview-own-project"', ' }', '}', '']
    return '\n'.join(lines)


async def nft(*args: str, input_text: str | None = None) -> int:
    process = await asyncio.create_subprocess_exec('/usr/sbin/nft', *args,
                                                 stdin=asyncio.subprocess.PIPE if input_text else asyncio.subprocess.DEVNULL,
                                                 stdout=asyncio.subprocess.DEVNULL,
                                                 stderr=asyncio.subprocess.DEVNULL)
    try:
        await asyncio.wait_for(process.communicate(input_text.encode() if input_text else None), 5)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        return -1
    return process.returncode


async def sync(config, previous):
    groups = browser_groups(config)
    try:
        browser_uid = pwd.getpwnam(config.browser['user']).pw_uid
        nginx_uid = pwd.getpwnam('www-data').pw_uid
    except (KeyError, TypeError):
        raise IsolationError('unavailable', 'The preview firewall accounts are unavailable') from None
    signature = (tuple(groups), browser_uid, nginx_uid)
    if signature == previous and await nft('list', 'table', 'inet', 'helena_previews') == 0:
        return signature
    if await nft('-f', '-', input_text=rules(config, groups, browser_uid, nginx_uid)) != 0:
        raise IsolationError('unavailable', 'The preview isolation firewall could not be configured')
    return signature
