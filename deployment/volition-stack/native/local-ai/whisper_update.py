#!/usr/bin/env python3
"""Operator-only, pinned Whisper update. No downloads or dependency installation."""

from __future__ import annotations

import argparse
import base64
import contextlib
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import tarfile
import tempfile
import time
import uuid

VERSION = '1.9.4'
COMMIT = '927cfce34f31707e17f2bff35c349632fb9e2c3a'
OLD = '/opt/helena-ai/voice/whisper-1.8.4/whisper-server'
DEST = Path('/opt/helena-ai/voice/whisper-1.9.4')
NEW = str(DEST / 'whisper-server')
ROCM = Path('/opt/helena-ai/rocm-10.0.0')
SDK = ROCM / 'lib/python3.13/site-packages/_rocm_sdk_devel'
STATE = Path('/var/lib/helena-whisper-update/1.9.4')
CACHE = Path('/var/cache/helena-ai/whisper-update-1.9.4')
BUILD_ROOT = Path('/var/lib')
STT = 'helena-voice-stt.service'
TTS = 'helena-voice-tts.service'
UNIT = Path('/etc/systemd/system') / STT
CANDIDATE = 'helena-whisper-check-1-9-4.service'
PRIVATE_UNIT = Path('/run/systemd/system') / CANDIDATE
MODELS = Path('/var/lib/helena-voice/models')
VOICES = Path('/var/lib/helena-voice/voices')
LIVE_PORT = 13306
CHECK_PORT = 13316
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/nonexistent',
       'LANG': 'C.UTF-8', 'GIT_CONFIG_NOSYSTEM': '1',
       'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_NO_REPLACE_OBJECTS': '1',
       'GIT_TERMINAL_PROMPT': '0'}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run(args, *, timeout=120, binary=False, log=None):
    try:
        result = subprocess.run([str(arg) for arg in args], env=ENV, capture_output=True,
                                timeout=timeout, check=False)
    except subprocess.TimeoutExpired as error:
        if log:
            save_output(log, error.stdout or b'', error.stderr or b'')
        raise
    if log:
        save_output(log, result.stdout, result.stderr)
    require(result.returncode == 0, f'{Path(args[0]).name} failed ({result.returncode})')
    return result.stdout if binary else result.stdout.decode().strip()


def save_output(path, stdout, stderr):
    atomic_write(path, b'STDOUT (last 1 MiB)\n' + stdout[-1048576:]
                 + b'\nSTDERR (last 1 MiB)\n' + stderr[-1048576:])


def secure(path, *, directory=False):
    path = Path(path)
    require(path.is_absolute(), 'Absolute path required')
    for parent in (path, *path.parents):
        info = parent.lstat()
        require(not stat.S_ISLNK(info.st_mode), f'Symlink rejected: {parent}')
        require(info.st_uid == 0 and not info.st_mode & 0o022,
                f'Root ownership and no group/other writes required: {parent}')
    require(path.is_dir() if directory else path.is_file(), f'Invalid path: {path}')


def sync_dir(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_write(path, data, mode=0o600):
    descriptor, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            os.fchmod(stream.fileno(), mode)
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_dir(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def save(path, record):
    atomic_write(path, (json.dumps(record, indent=2, sort_keys=True) + '\n').encode())


def read_record(path):
    secure(path)
    require(path.stat().st_size < 8 * 1024 * 1024, 'Oversized update record')
    return json.loads(path.read_bytes())


def properties(unit):
    wanted = 'FragmentPath,DropInPaths,ActiveState,SubState,MainPID,NeedDaemonReload'
    text = run(['systemctl', 'show', unit, f'--property={wanted}'])
    return dict(line.split('=', 1) for line in text.splitlines() if '=' in line)


def exec_args(unit_bytes, expected):
    text = unit_bytes.decode('utf-8')
    lines = re.sub(r'\\\n[ \t]*', ' ', text).splitlines()
    require(not any(re.match(r'\s*(ExecStartPre|ExecStartPost|ExecStop|ExecStopPost|EnvironmentFile)\s*=', line)
                    for line in lines), 'Unit lifecycle hooks require review')
    starts = [line[len('ExecStart='):] for line in lines if line.startswith('ExecStart=')]
    require(len(starts) == 1, 'Expected exactly one ExecStart')
    require('$' not in starts[0] and '%' not in starts[0], 'Dynamic ExecStart rejected')
    args = shlex.split(starts[0])
    require(args and args[0] == expected, 'Unexpected STT executable')
    required = {'--host': '127.0.0.1', '--port': str(LIVE_PORT), '--language': 'de',
                '--request-path': '/v1', '--inference-path': '/audio/transcriptions'}
    for key, value in required.items():
        require(args.count(key) == 1 and args.index(key) + 1 < len(args)
                and args[args.index(key) + 1] == value, f'Unexpected {key}')
    require('--vad' in args and '--flash-attn' in args, 'Existing VAD/flash settings required')
    for key in ('--model', '--vad-model'):
        require(args.count(key) == 1 and args.index(key) + 1 < len(args), f'Missing {key}')
        path = Path(args[args.index(key) + 1])
        require(path.parent == MODELS and path.name not in ('.', '..'), 'Unexpected model path')
    return args


def replace_executable(unit_bytes, old, new):
    exec_args(unit_bytes, old)
    pattern = rb'(?m)^ExecStart=' + re.escape(old.encode()) + rb'(?=\s)'
    updated, count = re.subn(pattern, b'ExecStart=' + new.encode(), unit_bytes)
    require(count == 1, 'Executable replacement was not unique')
    return updated


def private_unit_bytes(before):
    require(not re.search(rb'(?m)^\s*(PrivateNetwork|Type)\s*=', before)
            and before.count(b'[Service]\n') == 1,
            'Existing service type/namespace configuration requires review')
    data = replace_executable(before, OLD, NEW)
    data = data.replace(f'--port {LIVE_PORT}'.encode(), f'--port {CHECK_PORT}'.encode())
    return data.replace(b'[Service]\n', b'[Service]\nType=exec\nPrivateNetwork=yes\n', 1)


def live_snapshot(expected):
    secure(UNIT)
    require(UNIT.stat().st_gid == 0, 'STT unit must belong to root:root')
    props = properties(STT)
    require(props.get('FragmentPath') == str(UNIT) and not props.get('DropInPaths'),
            'Unexpected STT unit or drop-ins')
    require(props.get('NeedDaemonReload') == 'no', 'STT has unloaded unit changes')
    require(props.get('ActiveState') == 'active' and props.get('SubState') == 'running',
            'STT must already be running')
    pid = int(props.get('MainPID', '0'))
    require(pid > 0 and os.readlink(f'/proc/{pid}/exe') == expected, 'Unexpected running STT')
    data = UNIT.read_bytes()
    exec_args(data, expected)
    return data


def preserved_state():
    tts = properties(TTS)
    require(tts.get('ActiveState') == 'active' and tts.get('SubState') == 'running',
            'TTS must remain running')
    files = {}
    for root in (MODELS, VOICES):
        for path in [root, *sorted(root.rglob('*'))]:
            info = path.lstat()
            require(not stat.S_ISLNK(info.st_mode), 'Model/voice symlink requires review')
            files[str(path)] = [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
                                info.st_mode, info.st_uid, info.st_gid]
            require(len(files) <= 10000, 'Unexpected model/voice tree size')
    unit_paths = [tts['FragmentPath'], *tts.get('DropInPaths', '').split()]
    return {'tts': tts, 'ttsUnitHashes': {p: digest(Path(p).read_bytes()) for p in unit_paths},
            'modelVoiceMetadata': files}


def idle():
    text = run(['ss', '-Htn', 'state', 'established', 'sport', '=', f':{LIVE_PORT}'])
    require(not text, 'STT has an established connection; retry in the maintenance window')


def cmake_args(source, build):
    return [str(ROCM / 'bin/cmake'), '-S', str(source), '-B', str(build), '-G', 'Ninja',
            '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DGGML_STATIC=OFF',
            '-DGGML_HIP=ON', '-DAMDGPU_TARGETS=gfx1151', '-DCMAKE_HIP_ARCHITECTURES=gfx1151',
            '-DGGML_NATIVE=OFF', '-DGGML_CCACHE=OFF',
            '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_SERVER=ON',
            '-DWHISPER_SDL2=OFF', '-DWHISPER_CURL=OFF',
            '-DFETCHCONTENT_FULLY_DISCONNECTED=ON', '-DFETCHCONTENT_UPDATES_DISCONNECTED=ON',
            f'-DCMAKE_MAKE_PROGRAM={ROCM}/bin/ninja',
            f'-DCMAKE_C_COMPILER={SDK}/lib/llvm/bin/clang',
            f'-DCMAKE_CXX_COMPILER={SDK}/lib/llvm/bin/clang++',
            f'-DCMAKE_HIP_COMPILER={SDK}/lib/llvm/bin/clang++',
            f'-DCMAKE_PREFIX_PATH={SDK}', f'-DCMAKE_BUILD_RPATH={SDK}/lib']


def build_command(source, name):
    build = BUILD_ROOT / name
    script = shlex.join(cmake_args(source, build)) + '\n' + shlex.join([
        str(ROCM / 'bin/cmake'), '--build', str(build), '--parallel', '2',
        '--target', 'whisper-server', 'whisper-cli'])
    props = ['DynamicUser=yes', f'StateDirectory={name}', 'StateDirectoryMode=0700',
             'PrivateNetwork=yes', 'PrivateDevices=yes', 'NoNewPrivileges=yes',
             'ProtectSystem=strict', 'ProtectHome=yes', 'PrivateTmp=yes',
             'ProtectKernelTunables=yes', 'ProtectKernelModules=yes',
             'ProtectControlGroups=yes', 'RestrictSUIDSGID=yes', 'MemoryHigh=12G',
             'MemoryMax=16G', 'CPUWeight=20', 'CPUQuota=200%', 'TasksMax=64', 'RuntimeMaxSec=5400',
             f'Environment=PATH={ROCM}/bin:/usr/bin:/bin HIP_PATH={SDK} ROCM_PATH={SDK}']
    command = ['systemd-run', '--quiet', '--wait', '--pipe', '--collect', f'--unit={name}']
    for prop in props:
        command += ['-p', prop]
    return command + ['/bin/sh', '-eu', '-c', script]


def source_archive(repository):
    secure(repository, directory=True)
    secure(repository / '.git', directory=True)
    git = ['git', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
           '-C', str(repository)]
    require(run(git + ['rev-parse', 'HEAD']) == COMMIT, 'Source HEAD does not match pin')
    require(run(git + ['remote', 'get-url', 'origin']) ==
            'https://github.com/ggml-org/whisper.cpp.git', 'Unexpected source origin')
    run(git + ['fsck', '--strict', '--no-reflogs'], timeout=300)
    # Export the object directly; working-tree filters must never run as root.
    return run(git + ['archive', '--format=tar', COMMIT], binary=True)


def unpack_source(data, destination):
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        members = archive.getmembers()
        require(sum(m.size for m in members) <= 256 * 1024 * 1024, 'Source archive too large')
        for member in members:
            path = Path(member.name)
            require(not path.is_absolute() and '..' not in path.parts
                    and (member.isfile() or member.isdir()), 'Unsafe source archive member')
        for member in members:
            target = destination / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o755)
            else:
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                with archive.extractfile(member) as stream:
                    atomic_write(target, stream.read(), 0o755 if member.mode & 0o111 else 0o644)
    for path in [destination, *destination.rglob('*')]:
        if path.is_dir():
            path.chmod(0o755)


def artifact_hashes(directory):
    result = {}
    for name in ('whisper-server', 'whisper-cli'):
        path = directory / name
        secure(path)
        data = path.read_bytes()
        require(len(data) > 1024 and data[:4] == b'\x7fELF', 'Expected native ELF executable')
        require(os.access(path, os.X_OK), 'Executable permission required')
        result[name] = digest(data)
    return result


def prepared():
    record = read_record(DEST / 'build.json')
    require(record.get('commit') == COMMIT and record.get('version') == VERSION,
            'Unrecognized build record')
    require(record.get('binaries') == artifact_hashes(DEST), 'Installed candidate changed')
    require(record.get('cmake') == cmake_args('SOURCE', 'BUILD'), 'Build settings changed')
    return record


def prepare(repository):
    if DEST.exists():
        return prepared()
    secure(DEST.parent, directory=True)
    for path in (ROCM / 'bin/cmake', ROCM / 'bin/ninja', SDK / 'lib/llvm/bin/clang',
                 SDK / 'lib/llvm/bin/clang++'):
        # The installed SDK legitimately uses compiler symlinks; check their resolved files.
        secure(path.resolve())
    archive = source_archive(repository)
    CACHE.mkdir(parents=True, exist_ok=True, mode=0o755)
    secure(CACHE, directory=True)
    CACHE.chmod(0o755)
    source = CACHE / f'source-{uuid.uuid4().hex}'
    source.mkdir(mode=0o755)
    unpack_source(archive, source)
    name = f'helena-whisper-build-{uuid.uuid4().hex[:12]}'
    save(STATE / 'build-attempt.json', {'commit': COMMIT, 'source': str(source),
                                      'buildUnit': name, 'startedAt': time.time()})
    try:
        run(build_command(source, name), timeout=5500, log=STATE / 'build.log')
    finally:
        if properties(f'{name}.service').get('ActiveState') in ('active', 'activating', 'deactivating'):
            run(['systemctl', 'stop', f'{name}.service'])
    built = BUILD_ROOT / name / 'bin'
    stage = DEST.parent / f'.whisper-1.9.4-{uuid.uuid4().hex}'
    stage.mkdir(mode=0o755)
    stage.chmod(0o755)
    for filename in ('whisper-server', 'whisper-cli'):
        binary = built / filename
        require(binary.is_file() and not binary.is_symlink(), 'Missing build artifact')
        atomic_write(stage / filename, binary.read_bytes(), 0o755)
    hashes = artifact_hashes(stage)
    for filename in hashes:
        headers = run(['readelf', '-h', str(stage / filename)])
        require('Advanced Micro Devices X86-64' in headers, 'Unexpected ELF architecture')
        dynamic = run(['readelf', '-d', str(stage / filename)])
        require(str(SDK / 'lib') in dynamic, 'Missing ROCm library path')
        require('libamdhip64' in dynamic and 'librocblas' in dynamic and 'libhipblas' in dynamic,
                'Expected HIP/rocBLAS/hipBLAS dependencies')
        require(not re.search(r'Shared library: \[lib(?:whisper|ggml)[^]]*\]', dynamic),
                'Unexpected shared project library')
    record = {'version': VERSION, 'commit': COMMIT, 'sourceArchiveSha256': digest(archive),
              'cmake': cmake_args('SOURCE', 'BUILD'), 'binaries': hashes,
              'buildDirectory': str(built.parent), 'createdAt': time.time()}
    save(stage / 'build.json', record)
    os.rename(stage, DEST)
    sync_dir(DEST.parent)
    return record


def wait_health(port):
    from whisper_acceptance import http_request
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            response = http_request(port, 'GET', '/v1/health', b'', {},
                                    min(2, deadline - time.monotonic()))
            require(response.status == 200 and json.loads(response.body) == {'status': 'ok'},
                    'Unexpected health response')
            return
        except (OSError, RuntimeError, ValueError):
            time.sleep(1)
    raise RuntimeError('STT readiness timed out')


def check_report(report):
    require(report.get('passed') is True, 'Speech acceptance failed; inspect saved report')


def cleanup_candidate():
    record_path = STATE / 'candidate-unit.json'
    require(record_path.exists(), 'No private candidate record')
    record = read_record(record_path)
    props = properties(CANDIDATE)
    require(not props.get('DropInPaths'), 'Candidate unit override requires review')
    if PRIVATE_UNIT.exists():
        secure(PRIVATE_UNIT)
        require(digest(PRIVATE_UNIT.read_bytes()) == record['sha256'],
                'Candidate unit changed externally')
        require(props.get('FragmentPath') in ('', str(PRIVATE_UNIT)),
                'Unexpected candidate unit origin')
        run(['systemctl', 'stop', CANDIDATE])
        PRIVATE_UNIT.unlink()
        sync_dir(PRIVATE_UNIT.parent)
        run(['systemctl', 'daemon-reload'])
    else:
        require(props.get('ActiveState') in ('inactive', 'failed'),
                'Candidate active without its expected unit')
    record['phase'] = 'stopped'
    save(record_path, record)


@contextlib.contextmanager
def candidate_network():
    require(hasattr(os, 'setns'), 'Python with os.setns is required for private acceptance')
    props = properties(CANDIDATE)
    pid = int(props.get('MainPID', '0'))
    require(props.get('ActiveState') == 'active' and pid > 0
            and os.readlink(f'/proc/{pid}/exe') == NEW, 'Unexpected candidate process')
    original = os.open('/proc/self/ns/net', os.O_RDONLY)
    try:
        target = os.open(f'/proc/{pid}/ns/net', os.O_RDONLY)
        try:
            require(os.fstat(original).st_ino != os.fstat(target).st_ino,
                    'Candidate must have a private network namespace')
            os.setns(target, 0)
            try:
                yield
            finally:
                os.setns(original, 0)
        finally:
            os.close(target)
    finally:
        os.close(original)


def acceptance(corpus, *, activate=False):
    from whisper_acceptance import run_server, compare_reports
    build = prepared()
    before = live_snapshot(OLD)
    retained = preserved_state()
    idle()
    baseline = run_server(LIVE_PORT, corpus)
    save(STATE / 'baseline.json', baseline)
    check_report(baseline)
    require(not PRIVATE_UNIT.exists(), 'Private candidate unit already exists')
    require(properties(CANDIDATE).get('ActiveState') in ('inactive', 'failed'),
            'Private candidate unit is in use')
    require(hasattr(os, 'setns'), 'Python with os.setns is required for private acceptance')
    candidate_unit = private_unit_bytes(before)
    save(STATE / 'candidate-unit.json', {'sha256': digest(candidate_unit), 'phase': 'prepared'})
    try:
        atomic_write(PRIVATE_UNIT, candidate_unit, 0o644)
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'start', CANDIDATE])
        with candidate_network():
            wait_health(CHECK_PORT)
            candidate = run_server(CHECK_PORT, corpus)
        comparison = compare_reports(baseline, candidate)
        save(STATE / 'candidate.json', {'report': candidate, 'comparison': comparison})
        check_report(candidate)
        check_report(comparison)
    finally:
        cleanup_candidate()
    require(preserved_state() == retained, 'TTS, voices or model metadata changed')
    require(live_snapshot(OLD) == before, 'STT changed during acceptance')
    require(prepared() == build, 'Build changed during acceptance')
    proof = {'build': build, 'oldBinaries': artifact_hashes(Path(OLD).parent),
             'unitSha256': digest(before), 'retained': retained,
             'baseline': baseline, 'candidate': candidate, 'comparison': comparison,
             'verifiedAt': time.time()}
    save(STATE / 'verified.json', proof)
    if activate:
        switch(before, proof, corpus)
    return proof


def restart_stt():
    run(['systemctl', 'daemon-reload'])
    if 'DeviceAllow=/dev/kfd' in run(['systemctl', 'cat', STT]):
        run(['/usr/local/lib/helena-ai/gpu-reset-watch', 'restart-group'])
    else:
        run(['systemctl', 'restart', STT])
    wait_health(LIVE_PORT)


def restore(record):
    before = base64.b64decode(record['before'], validate=True)
    after = replace_executable(before, OLD, NEW)
    require(digest(before) == record['beforeSha256'] and digest(after) == record['afterSha256'],
            'Invalid rollback unit record')
    require(artifact_hashes(Path(OLD).parent) == record['proof']['oldBinaries'],
            'Previous binaries changed; rollback requires review')
    secure(UNIT)
    require(UNIT.read_bytes() in (before, after), 'STT unit changed externally; preserve it for review')
    props = properties(STT)
    require(props.get('FragmentPath') == str(UNIT) and not props.get('DropInPaths'),
            'STT unit override requires review')
    record['phase'] = 'restoring'
    save(STATE / 'transaction.json', record)
    atomic_write(UNIT, before, record['mode'])
    restart_stt()
    live_snapshot(OLD)
    record['phase'] = 'restored-health-only'
    save(STATE / 'transaction.json', record)


def switch(before, proof, corpus):
    from whisper_acceptance import run_server, compare_reports
    require(live_snapshot(OLD) == before, 'STT changed before activation')
    idle()
    after = replace_executable(before, OLD, NEW)
    record = {'version': VERSION, 'commit': COMMIT, 'phase': 'prepared',
              'before': base64.b64encode(before).decode(), 'beforeSha256': digest(before),
              'afterSha256': digest(after), 'mode': stat.S_IMODE(UNIT.stat().st_mode),
              'proof': proof, 'createdAt': time.time()}
    save(STATE / 'transaction.json', record)
    try:
        atomic_write(UNIT, after, record['mode'])
        restart_stt()
        live_snapshot(NEW)
        report = run_server(LIVE_PORT, corpus)
        save(STATE / 'live.json', report)
        check_report(report)
        check_report(compare_reports(proof['baseline'], report))
        require(preserved_state() == proof['retained'], 'TTS, voices or model metadata changed')
        record['phase'] = 'active'
        save(STATE / 'transaction.json', record)
    except BaseException:
        restore(record)
        report = run_server(LIVE_PORT, corpus)
        save(STATE / 'rollback.json', report)
        check_report(report)
        check_report(compare_reports(proof['baseline'], report))
        record['phase'] = 'restored-verified'
        save(STATE / 'transaction.json', record)
        raise


@contextlib.contextmanager
def lock():
    require(os.geteuid() == 0, 'Operator phases require root')
    secure(Path(__file__).resolve())
    secure(Path(__file__).with_name('whisper_acceptance.py').resolve())
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    secure(STATE, directory=True)
    sync_dir(STATE.parent)
    sync_dir(STATE.parent.parent)
    descriptor = os.open(STATE / 'lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('plan', 'prepare', 'verify', 'activate', 'rollback', 'cleanup'))
    parser.add_argument('--source-repo', type=Path)
    parser.add_argument('--corpus', type=Path)
    parser.add_argument('--corpus-sha256')
    args = parser.parse_args()
    if args.action == 'plan':
        print(json.dumps({'version': VERSION, 'commit': COMMIT, 'destination': str(DEST),
                          'cmake': cmake_args('SOURCE', 'BUILD'),
                          'build': build_command('SOURCE', 'helena-whisper-build-PLAN')}, indent=2))
        return
    with lock():
        if args.action == 'cleanup':
            cleanup_candidate()
            print('Private candidate stopped; live STT and TTS unchanged.')
            return
        transaction = STATE / 'transaction.json'
        previous = read_record(transaction) if transaction.exists() else None
        if args.action == 'rollback':
            require(previous is not None, 'No rollback record')
            idle()
            restore(previous)
            print('Old STT unit restored; health passed. Speech re-verification is still required.')
            return
        if previous:
            require(previous.get('phase') in ('restored-verified', 'restored-health-only', 'active'),
                    'Interrupted transaction: run rollback before another operation')
            if previous.get('phase') == 'active':
                require(args.action == 'activate', 'Release is already active')
                require(digest(live_snapshot(NEW)) == previous['afterSha256'],
                        'Active unit changed')
                require(prepared() == previous['proof']['build'], 'Active build changed')
                print('This package is already active; no services changed.')
                return
        if args.action == 'prepare':
            require(args.source_repo is not None, '--source-repo is required')
            prepare(args.source_repo)
        else:
            from whisper_acceptance import load_corpus
            require(args.corpus is not None and args.corpus_sha256 is not None,
                    '--corpus and --corpus-sha256 are required')
            corpus = load_corpus(args.corpus, args.corpus_sha256)
            acceptance(corpus, activate=args.action == 'activate')
        print(f'{args.action} completed for Whisper {VERSION}')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        raise SystemExit(str(error)) from error
