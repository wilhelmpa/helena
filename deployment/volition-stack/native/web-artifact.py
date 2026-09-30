#!/usr/bin/env python3
"""Package and verify a Linux x86_64 web release for web-release.sh --artifact.

Use build-web-release.sh on the Mac: it obtains the exact commit from Kingston and runs
the build in a Linux x86_64 container. A native Darwin build is not a valid release.

  web-artifact.py build --repo CLONE --commit SHA --out DIR
      A clean Linux x86_64 worktree of CLONE at SHA; installs dependencies, builds and
      packages DIR/web-<id>/ with manifest and checksums. Prints the directory.
  web-artifact.py verify DIR --commit SHA
      The manifest names SHA and the target lockfile hash; files and native modules match.

The archive subcommand validates and extracts tarballs. See README.md for deploy steps.
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
import tarfile
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


def package(tree, commit, out_root):
    """Package an already built Linux x64 tree without copying its build cache."""
    if platform.system().lower() != TARGET_OS or platform.machine().lower() not in ('x86_64', 'amd64'):
        raise ValueError('packaging requires a Linux x86_64 build environment')
    tree = Path(tree)
    ident = deployment_id(commit)
    out = Path(out_root).resolve() / ('web-' + ident)
    if out.exists():
        shutil.rmtree(out)
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
        'lockfileSha256': sha256(tree / 'bun.lock'),
        'deploymentId': ident,
        'platform': TARGET_OS + '-' + TARGET_CPU,
        'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'builtOn': platform.platform(),
        'buildHost': os.environ.get('VOLITION_BUILD_HOST', platform.node()),
        'bun': subprocess.check_output(['bun', '--version'], text=True).strip(),
        'node': subprocess.check_output(['node', '--version'], text=True).strip(),
        'files': files,
        'links': links,
        'removedForOtherPlatforms': removed,
    }
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (out / 'SHA256SUMS').write_text(''.join(f'{digest}  {name}\n' for name, digest in files.items()))
    return out


def build(args):
    if platform.system().lower() != TARGET_OS or platform.machine().lower() not in ('x86_64', 'amd64'):
        raise ValueError('build requires Linux x86_64; use build-web-release.sh on the Mac')
    commit = subprocess.check_output(
        ['git', '-C', args.repo, 'rev-parse', '--verify', args.commit + '^{commit}'], text=True).strip()
    ident = deployment_id(commit)
    out = Path(args.out).resolve() / ('web-' + ident)
    if out.exists():
        shutil.rmtree(out)
    work = Path(tempfile.mkdtemp(prefix='volition-web-artifact-'))
    tree = work / 'tree'
    try:
        run(['git', '-C', args.repo, 'worktree', 'add', '--detach', str(tree), commit])
        run(['bun', 'install', '--frozen-lockfile', *(['--offline'] if args.offline else [])], cwd=tree)
        env = dict(os.environ, NEXT_DEPLOYMENT_ID=ident, NEXT_TELEMETRY_DISABLED='1')
        run(['bun', 'run', 'build'], cwd=tree / 'apps/web', env=env)
        out = package(tree, commit, args.out)
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


def check(root, commit, lockfile_sha256=None):
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
    if not re.fullmatch(r'[0-9a-f]{64}', manifest.get('lockfileSha256', '')):
        problems.append('missing or malformed lockfile hash')
    if lockfile_sha256 and manifest.get('lockfileSha256') != lockfile_sha256:
        problems.append('lockfile hash does not match the target commit')
    if manifest.get('deploymentId') != deployment_id(commit):
        problems.append('deployment id does not match the commit')
    if manifest.get('platform') != TARGET_OS + '-' + TARGET_CPU:
        problems.append('built for ' + str(manifest.get('platform')))
    for field in ('buildHost', 'node', 'bun'):
        if not isinstance(manifest.get(field), str) or not manifest[field]:
            problems.append('missing ' + field)
    for required in ('standalone/apps/web/server.js', 'static'):
        if not (root / required).exists():
            problems.append('missing ' + required)
    expected = {}
    for line in sums.splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
        if not match:
            problems.append('malformed SHA256SUMS line')
            continue
        if match.group(2) in expected:
            problems.append('duplicate SHA256SUMS entry')
        expected[match.group(2)] = match.group(1)
    files, links = inventory(root)
    if manifest.get('files') != files:
        problems.append('file hashes differ from the manifest')
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


def unpack_archive(archive, destination, commit, lockfile_sha256):
    """Validate archive member names/types before extraction, then validate contents."""
    destination = Path(destination)
    with tarfile.open(archive, 'r:*') as tar:
        for member in tar:
            parts = Path(member.name).parts
            if (not parts or parts[0] != 'web-' + deployment_id(commit)
                    or '..' in parts or member.name.startswith('/')
                    or not (member.isfile() or member.isdir() or member.issym() or member.islnk())):
                raise ValueError('unsafe archive member: ' + member.name)
        tar.extractall(destination, filter='data')
    root = destination / ('web-' + deployment_id(commit))
    problems = check(root, commit, lockfile_sha256)
    if problems:
        raise ValueError('; '.join(problems[:10]))
    return root


def archive_action(args):
    try:
        if args.out:
            destination = Path(args.out)
            destination.mkdir(parents=True, exist_ok=True)
            unpack_archive(args.archive, destination, args.commit, args.lockfile_sha256)
        else:
            with tempfile.TemporaryDirectory(prefix='volition-web-verify-') as temp:
                unpack_archive(args.archive, temp, args.commit, args.lockfile_sha256)
    except (OSError, ValueError, tarfile.TarError) as error:
        print('web-artifact: ' + str(error), file=sys.stderr)
        return 1
    print('web-artifact: ok')
    return 0


def verify(args):
    problems = check(args.dir, args.commit, args.lockfile_sha256)
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
    b.add_argument('--offline', action='store_true')
    p = commands.add_parser('package')
    p.add_argument('--tree', required=True)
    p.add_argument('--commit', required=True)
    p.add_argument('--out', required=True)
    v = commands.add_parser('verify')
    v.add_argument('dir')
    v.add_argument('--commit', required=True)
    v.add_argument('--lockfile-sha256')
    a = commands.add_parser('archive')
    a.add_argument('archive')
    a.add_argument('--commit', required=True)
    a.add_argument('--lockfile-sha256', required=True)
    a.add_argument('--out')
    args = parser.parse_args(argv)
    if args.command == 'build':
        return build(args)
    if args.command == 'package':
        print(package(args.tree, args.commit, args.out))
        return 0
    if args.command == 'archive':
        return archive_action(args)
    return verify(args)


if __name__ == '__main__':
    sys.exit(main())
