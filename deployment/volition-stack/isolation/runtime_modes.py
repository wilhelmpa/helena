#!/usr/bin/python3 -I
"""The code every isolated agent runs, readable by every agent.

An isolated agent runs as its project's user (vp-<slug>), and its unit binds the runtimes' code
read-only from the host: Hermes' virtual environment, its Python, its tools. A bind keeps the
files' own modes, so a file there that only its owner may read fails every agent that imports
it. On 2026-09-25 that was `docstring_parser` in Hermes' venv (root 0600, installed by uv from
a cache written under umask 077): the `anthropic` SDK imports it, so every agent on a Claude
model stopped at "credentials or agent init failed", while the OpenAI models, which never
import it, ran.

launcher.json lists these trees as `sharedCode`: code only, never a secret, the same for every
project. This program checks them and opens them to every reader:

    runtime_modes.py check  --config launcher.json [--json]
    runtime_modes.py repair --config launcher.json [--dry-run] [--json]

`check` exits 1 when an agent cannot read a source file (a module, a data file, a program),
and 0 when all it lacks is Python's bytecode cache (`__pycache__`), which Python rebuilds from
the source in memory (only slower). `repair` (root) gives group and others read, and search on
directories and executables, and takes their write away; it is what isolation.sh runs on
install, sync and apply, and what helena-hermes-update does to the venv after an install.

The walk goes by file descriptor and never follows a link. A regular file with more than one
name is opened up only when root owns it (the owner of such a tree can link a file of its own,
not someone else's, and a link of root's is root's). Entries owned by anyone but root and the
tree's owner are left alone. Nothing is read beyond the modes.
"""

from __future__ import annotations

import argparse
import json
import os
import stat
import sys
from dataclasses import dataclass, field

O_DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
O_FILE = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_NOCTTY | os.O_CLOEXEC
MAX_DEPTH = 64
MAX_ENTRIES = 1_000_000
EXAMPLES = 5


@dataclass
class TreeReport:
    path: str
    exists: bool = True
    entries: int = 0
    # Entries a reader other than the owner cannot read (files) or list and enter (directories).
    unreadable: int = 0
    # Of those, what is not Python's bytecode cache: the ones that break an import.
    sources: int = 0
    # Entries repair changed (or would change, dry run).
    opened: int = 0
    # Entries left alone although unreadable: a link, a multi-linked file of another owner, a
    # foreign owner, or not a regular file or directory.
    skipped: int = 0
    examples: list[str] = field(default_factory=list)
    truncated: bool = False

    def as_dict(self) -> dict:
        return {
            'path': self.path, 'exists': self.exists, 'entries': self.entries, 'unreadable': self.unreadable,
            'sources': self.sources, 'opened': self.opened, 'skipped': self.skipped,
            'examples': self.examples, 'truncated': self.truncated,
        }


def is_bytecode(relative: str) -> bool:
    parts = relative.split('/')
    return '__pycache__' in parts or relative.endswith(('.pyc', '.pyo'))


def readable_by_others(mode: int) -> bool:
    """A directory others may list and enter, a file others may read, and run when its owner may."""
    if stat.S_ISDIR(mode):
        return mode & 0o005 == 0o005
    return bool(mode & 0o004) and not (mode & 0o100 and not mode & 0o001)


def opened_mode(mode: int) -> int:
    """go+rX, go-w (chmod's semantics): read for group and others, search on a directory or on
    a file somebody may execute, and nobody but the owner may write. Special bits stay."""
    wanted = (stat.S_IMODE(mode) | 0o044) & ~0o022
    if stat.S_ISDIR(mode) or mode & 0o111:
        wanted |= 0o011
    return wanted


def walk(tree: str, *, repair: bool = False, dry_run: bool = False) -> TreeReport:
    """Checks one tree (and opens it up with repair). A missing tree is reported, not an error:
    optional runtimes (uv tools, bin) are not on every machine."""
    report = TreeReport(tree)
    try:
        top = os.open(tree, O_DIR)
    except FileNotFoundError:
        report.exists = False
        return report
    except OSError as error:
        raise SystemExit(f'runtime_modes: {tree}: {error.strerror}') from None
    owners = {0, os.fstat(top).st_uid}

    def consider(fd: int, info: os.stat_result, relative: str) -> None:
        report.entries += 1
        if readable_by_others(info.st_mode):
            return
        report.unreadable += 1
        if not is_bytecode(relative):
            report.sources += 1
            if len(report.examples) < EXAMPLES:
                report.examples.append(relative or '.')
        if not repair:
            return
        if info.st_uid not in owners or (stat.S_ISREG(info.st_mode) and info.st_nlink > 1 and info.st_uid != 0):
            report.skipped += 1
            return
        report.opened += 1
        if not dry_run:
            os.fchmod(fd, opened_mode(info.st_mode))

    def visit(dir_fd: int, prefix: str, depth: int) -> None:
        if depth > MAX_DEPTH:
            report.truncated = True
            return
        for name in sorted(os.listdir(dir_fd)):
            if report.entries >= MAX_ENTRIES:
                report.truncated = True
                return
            relative = f'{prefix}{name}'
            info = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                flags = O_DIR
            elif stat.S_ISREG(info.st_mode):
                flags = O_FILE
            else:
                # Links are never followed (what they point at is checked where it lives);
                # sockets, pipes and devices have no business in a code tree.
                if not stat.S_ISLNK(info.st_mode) and not readable_by_others(info.st_mode):
                    report.entries += 1
                    report.unreadable += 1
                    report.skipped += 1
                continue
            try:
                child = os.open(name, flags, dir_fd=dir_fd)
            except OSError:
                report.skipped += 1
                continue
            try:
                opened = os.fstat(child)
                if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                    report.skipped += 1
                    continue
                consider(child, opened, relative)
                if stat.S_ISDIR(opened.st_mode):
                    visit(child, f'{relative}/', depth + 1)
            finally:
                os.close(child)

    try:
        consider(top, os.fstat(top), '')
        visit(top, '', 0)
    finally:
        os.close(top)
    return report


def shared_code(config_path: str) -> tuple[str, ...]:
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    import isolation_common as common  # noqa: PLC0415 - next to this file, installed or not

    return common.load_config(config_path, require_root=os.geteuid() == 0).shared_code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('command', choices=('check', 'repair'))
    parser.add_argument('--config', required=True, help='launcher.json (its sharedCode)')
    parser.add_argument('--tree', action='append', default=[], help='a tree instead of the configured ones')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    trees = tuple(args.tree) or shared_code(args.config)
    repair = args.command == 'repair'
    if repair and os.geteuid() != 0 and not os.environ.get('RUNTIME_MODES_TEST'):
        print('runtime_modes: repair needs root', file=sys.stderr)
        return 2
    reports = [walk(os.path.normpath(tree), repair=repair, dry_run=args.dry_run) for tree in trees]
    if args.json:
        print(json.dumps({'command': args.command, 'dryRun': args.dry_run,
                          'trees': [r.as_dict() for r in reports]}, indent=1))
    else:
        for r in reports:
            if not r.exists:
                print(f'{r.path}: not there')
            elif repair:
                verb = 'would open' if args.dry_run else 'opened'
                print(f'{r.path}: {verb} {r.opened} of {r.unreadable} unreadable entries'
                      + (f', left {r.skipped} alone' if r.skipped else ''))
            elif r.unreadable:
                print(f'{r.path}: {r.unreadable} of {r.entries} entries unreadable for the agents '
                      f'({r.sources} not bytecode' + (f': {", ".join(r.examples)}' if r.examples else '') + ')')
            else:
                print(f'{r.path}: readable ({r.entries} entries)')
    if repair:
        return 1 if any(r.skipped for r in reports) else 0
    return 1 if any(r.sources for r in reports) else 0


if __name__ == '__main__':
    sys.exit(main())
