#!/usr/bin/env python3
"""Root-only recovery of one dead native Linux mail-triage runtime; never stops a process."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys


def require(ok):
    if not ok:
        raise RuntimeError('Recovery guard failed')


def quoted(value):
    return "'" + value.replace("'", "''") + "'"


def sql(statement):
    result = subprocess.run(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-qAt',
        '-d', 'itsaplan', '-v', 'ON_ERROR_STOP=1', '-c',
        "SET statement_timeout='5s'; SET lock_timeout='2s'; " + statement],
        capture_output=True, text=True, timeout=10,
        env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
    require(result.returncode == 0 and len(result.stdout) < 100_000)
    return json.loads(result.stdout)


def dead_runtime(runtime, read_text=None, read_link=None):
    read_text = read_text or (lambda path: Path(path).read_text().strip())
    read_link = read_link or os.readlink
    require(runtime['version'] == 1 and type(runtime['pid']) is int and runtime['pid'] > 0)
    require(re.fullmatch(r'[a-f0-9]{32}', runtime['machineId']) is not None)
    require(re.fullmatch(r'[a-f0-9-]{36}', runtime['bootId']) is not None)
    require(re.fullmatch(r'\d+', runtime['startTicks']) is not None)
    require(re.fullmatch(r'helena-\d+-[a-f0-9-]{36}', runtime['databaseRuntimeName']) is not None)
    require(read_text('/etc/machine-id') == runtime['machineId'])
    if read_text('/proc/sys/kernel/random/boot_id') != runtime['bootId']:
        return 'previous-boot'
    require(read_link('/proc/self/ns/pid') == runtime['pidNamespace'])
    try:
        process_stat = read_text('/proc/' + str(runtime['pid']) + '/stat')
    except FileNotFoundError:
        return 'process-absent'
    fields = process_stat[process_stat.rfind(') ') + 2:].split()
    require(len(fields) > 19)
    require(fields[19] != runtime['startTicks'])
    return 'different-process-start'


def verify_ended(claim):
    reason = dead_runtime(claim['runtime'])
    active = sql(session_statement(claim['runtime']))
    require(active == 0)
    return reason


def session_statement(runtime):
    return ('SELECT count(*) FROM pg_stat_activity WHERE application_name=' +
            quoted(runtime['databaseRuntimeName']))


def release_statement(claim):
    require(type(claim['project_id']) is int and claim['project_id'] > 0)
    require(re.fullmatch(r'[a-f0-9-]{36}', claim['run_token']) is not None)
    return ('WITH removed AS (DELETE FROM helena_mail_triage_claim c WHERE project_id=' +
            str(claim['project_id']) + ' AND run_token=' + quoted(claim['run_token']) +
            ' AND to_jsonb(c)=' + quoted(json.dumps(claim)) +
            '::jsonb RETURNING project_id) SELECT count(*) FROM removed')


def private_parent(path):
    require(path.is_absolute() and '..' not in path.parts)
    for parent in path.parents:
        require(stat.S_ISDIR(parent.lstat().st_mode))
    info = path.parent.stat()
    require(info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o700)


def read_private(path):
    private_parent(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1)
        require(stat.S_IMODE(info.st_mode) == 0o600 and info.st_size < 100_000)
        return stream.read()


def write_private(path, value):
    private_parent(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, sort_keys=True)
        stream.write('\n'); stream.flush(); os.fsync(fd)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def current(project):
    require(type(project) is int and project > 0)
    return sql('SELECT coalesce((SELECT to_jsonb(c) FROM helena_mail_triage_claim c WHERE project_id=' + str(project) + "), 'null'::jsonb)")


def main(args):
    require(sys.platform == 'linux' and os.geteuid() == 0)
    require(len(args) in [3, 4])
    if args[0] == 'inspect':
        require(len(args) == 3)
        claim = current(int(args[1])); require(claim is not None)
        reason = verify_ended(claim)
        write_private(Path(args[2]), {'version': 1, 'claim': claim, 'processEndProof': reason})
    else:
        require(args[0] == 'release' and len(args) == 4)
        raw = read_private(Path(args[1]))
        require(re.fullmatch(r'[a-f0-9]{64}', args[2]) is not None)
        require(hashlib.sha256(raw).hexdigest() == args[2])
        reviewed = json.loads(raw); require(reviewed['version'] == 1)
        claim = reviewed['claim']; require(current(claim['project_id']) == claim)
        reason = verify_ended(claim)
        evidence = Path(args[3])
        write_private(evidence, {'phase': 'intent', 'reviewedSha256': args[2],
                                'claim': claim, 'processEndProof': reason})
        # Full-row + token CAS: a fresh runtime/claim is never released by an old review.
        removed = sql(release_statement(claim))
        require(removed == 1)
        write_private(Path(str(evidence) + '.complete.json'),
                      {'released': True, 'projectId': claim['project_id'], 'reviewedSha256': args[2]})
    print(json.dumps({'completed': True}))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main(sys.argv[1:])
    except BaseException:
        # No private row, connection error or system diagnostics on the terminal.
        print(json.dumps({'completed': False, 'category': 'claim-recovery-refused',
                          'retainEvidence': True}), file=sys.stderr)
        sys.exit(1)
