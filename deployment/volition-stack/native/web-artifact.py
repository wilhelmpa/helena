#!/usr/bin/env python3
"""A web build made on another machine than the server, for web-release.sh --artifact.

Building the web app takes about 12 GB for a few minutes, which the server running Helena,
its agents and the local models cannot spare. This builds it elsewhere (the owner's Mac, a
second PC) from the exact commit, for the server's platform, and checks it again on the
server before anything is installed.

  web-artifact.py build --repo CLONE --commit SHA --out DIR
      A clean worktree of CLONE at SHA; `bun install` with the server's native packages
      (linux-x64) next to the build machine's; `next build` with the deployment id the
      server uses; the standalone server, its static files and public/ copied to
      DIR/web-<id>/, packages for other platforms left out, a manifest and the checksum of
      every file written. Prints the directory.
  web-artifact.py verify DIR --commit SHA
      The manifest names SHA; every file is there and unchanged, and there is no other; no
      link points outside; every native module is linux-x64 (ELF, x86-64). Exit 1 otherwise.

Then, e.g.:
  rsync -a --delete DIR/web-<id>/ kingston:agent-work/web-artifacts/<id>/
  sudo deploy.sh --expect SHA --web-artifact /home/wilhelmpa/agent-work/web-artifacts/<id> BRANCH
"""
import argparse
import datetime
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FORMAT = 1
TARGET_OS, TARGET_CPU = 'linux', 'x64'
ELF_MACHINE_X86_64 = 0x3E


def deployment_id(commit):
    return commit[:12]


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def run(args, cwd=None, env=None):
    print('+ ' + ' '.join(args), file=sys.stderr)
    subprocess.run(args, cwd=cwd, env=env, check=True)


def elf_x86_64(path):
    with open(path, 'rb') as stream:
        head = stream.read(20)
    return (len(head) == 20 and head[:4] == b'\x7fELF' and head[4] == 2 and head[5] == 1
            and int.from_bytes(head[18:20], 'little') == ELF_MACHINE_X86_64)


def matches(values, wanted):
    """npm's os/cpu fields: a list of allowed names, or of '!name' exclusions."""
    if not values:
        return True
    if isinstance(values, str):
        values = [values]
    allowed = [value for value in values if not value.startswith('!')]
    if ('!' + wanted) in values:
        return False
    return not allowed or wanted in allowed


def prune_other_platforms(root):
    """Removes the packages the server cannot load (npm os/cpu fields), and links left dangling."""
    removed = []
    for manifest in sorted(root.rglob('package.json')):
        if 'node_modules' not in manifest.parts:
            continue
        try:
            data = json.loads(manifest.read_text())
        except (OSError, ValueError):
            continue
        if matches(data.get('os'), TARGET_OS) and matches(data.get('cpu'), TARGET_CPU):
            continue
        package = manifest.parent
        # Bun's store: node_modules/.bun/<name@version>/node_modules/<name>; the whole entry goes.
        parts = package.parts
        if '.bun' in parts:
            package = Path(*parts[:parts.index('.bun') + 2])
        if package.exists():
            shutil.rmtree(package)
            removed.append(str(package.relative_to(root)))
    for link in sorted(root.rglob('*')):
        if link.is_symlink() and not link.exists():
            link.unlink()
    return removed


def inventory(root):
    files, links = {}, {}
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root).as_posix()
        if relative in ('manifest.json', 'SHA256SUMS'):
            continue
        if path.is_symlink():
            links[relative] = os.readlink(path)
        elif path.is_file():
            files[relative] = sha256(path)
    return files, links


def build(args):
    commit = subprocess.check_output(
        ['git', '-C', args.repo, 'rev-parse', '--verify', args.commit + '^{commit}'], text=True).strip()
    ident = deployment_id(commit)
    out = Path(args.out).resolve() / ('web-' + ident)
    if out.exists():
        shutil.rmtree(out)
    work = Path(tempfile.mkdtemp(prefix='helena-web-artifact-'))
    tree = work / 'tree'
    try:
        run(['git', '-C', args.repo, 'worktree', 'add', '--detach', str(tree), commit])
        install = ['bun', 'install', '--frozen-lockfile']
        host = (platform.system().lower(), {'x86_64': 'x64', 'amd64': 'x64'}.get(platform.machine().lower(), platform.machine().lower()))
        if host != (TARGET_OS, TARGET_CPU):
            # The build machine's own native packages to build with, the server's to run on.
            install += ['--os=*', '--cpu=*']
        run(install, cwd=tree)
        env = dict(os.environ, NEXT_DEPLOYMENT_ID=ident, NEXT_TELEMETRY_DISABLED='1')
        run(['bun', 'run', 'build'], cwd=tree / 'apps/web', env=env)
        web = tree / 'apps/web'
        out.mkdir(parents=True)
        shutil.copytree(web / '.next/standalone', out / 'standalone', symlinks=True)
        shutil.copytree(web / '.next/static', out / 'static', symlinks=True)
        if (web / 'public').is_dir():
            shutil.copytree(web / 'public', out / 'public', symlinks=True)
        removed = prune_other_platforms(out / 'standalone')
        files, links = inventory(out)
        manifest = {
            'format': FORMAT,
            'commit': commit,
            'deploymentId': ident,
            'platform': TARGET_OS + '-' + TARGET_CPU,
            'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
            'builtOn': platform.platform(),
            'bun': subprocess.check_output(['bun', '--version'], text=True).strip(),
            'node': subprocess.check_output(['node', '--version'], text=True).strip(),
            'links': links,
            'removedForOtherPlatforms': removed,
        }
        (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        (out / 'SHA256SUMS').write_text(''.join(f'{digest}  {name}\n' for name, digest in files.items()))
    finally:
        subprocess.run(['git', '-C', args.repo, 'worktree', 'remove', '--force', str(tree)], check=False)
        shutil.rmtree(work, ignore_errors=True)
    problems = check(out, commit)
    if problems:
        for problem in problems:
            print('web-artifact: ' + problem, file=sys.stderr)
        return 1
    print(out)
    return 0


def check(root, commit):
    root = Path(root).resolve()
    problems = []
    try:
        manifest = json.loads((root / 'manifest.json').read_text())
        sums = (root / 'SHA256SUMS').read_text()
    except (OSError, ValueError) as error:
        return ['no readable manifest.json and SHA256SUMS: ' + str(error)]
    if manifest.get('format') != FORMAT:
        problems.append('unknown artifact format')
    if not re.fullmatch(r'[0-9a-f]{40}', commit or ''):
        problems.append('the commit to check against must be a full SHA')
    if manifest.get('commit') != commit:
        problems.append(f"built from {manifest.get('commit')}, not {commit}")
    if manifest.get('deploymentId') != deployment_id(commit):
        problems.append('deployment id does not match the commit')
    if manifest.get('platform') != TARGET_OS + '-' + TARGET_CPU:
        problems.append('built for ' + str(manifest.get('platform')))
    for required in ('standalone/apps/web/server.js', 'static'):
        if not (root / required).exists():
            problems.append('missing ' + required)
    expected = {}
    for line in sums.splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
        if not match:
            problems.append('malformed SHA256SUMS line')
            continue
        expected[match.group(2)] = match.group(1)
    files, links = inventory(root)
    for name in sorted(set(expected) - set(files)):
        problems.append('missing file ' + name)
    for name in sorted(set(files) - set(expected)):
        problems.append('file not in SHA256SUMS: ' + name)
    for name in sorted(set(files) & set(expected)):
        if files[name] != expected[name]:
            problems.append('changed file ' + name)
    if links != manifest.get('links'):
        problems.append('the links differ from the manifest')
    for name, target in links.items():
        resolved = (root / name).parent / target
        if os.path.isabs(target) or not os.path.normpath(resolved).startswith(str(root) + os.sep):
            problems.append('link points outside the artifact: ' + name)
    for name in files:
        if name.endswith('.node') and not elf_x86_64(root / name):
            problems.append('native module not for linux-x64: ' + name)
    return problems


def verify(args):
    problems = check(args.dir, args.commit)
    for problem in problems[:50]:
        print('web-artifact: ' + problem, file=sys.stderr)
    if problems:
        print(f'web-artifact: {len(problems)} problems, not installed', file=sys.stderr)
        return 1
    print('web-artifact: ok')
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    commands = parser.add_subparsers(dest='command', required=True)
    b = commands.add_parser('build')
    b.add_argument('--repo', required=True)
    b.add_argument('--commit', required=True)
    b.add_argument('--out', required=True)
    v = commands.add_parser('verify')
    v.add_argument('dir')
    v.add_argument('--commit', required=True)
    args = parser.parse_args(argv)
    return build(args) if args.command == 'build' else verify(args)


if __name__ == '__main__':
    sys.exit(main())
