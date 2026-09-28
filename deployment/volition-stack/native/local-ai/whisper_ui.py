#!/usr/bin/env python3
"""Fixed Whisper UI bridge. Root prepares and verifies the package before authorizing a window."""

import argparse
import contextlib
import json
import math
import os
import pwd
import stat
from pathlib import Path
import re
import select
import subprocess
import time
import uuid

import whisper_update as operator
from whisper_acceptance import load_corpus

CORPUS = Path('/var/lib/helena-whisper-corpus')
REQUESTS = Path('/var/lib/helena-updates/spool/voice-requests')
WINDOW_SECONDS = 300
LOCK_NAMESPACE = 748220
LOCK_KEY = 13306
MAINTENANCE = Path('/var/lib/helena-updates/voice-maintenance.json')


class NotReady(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def check(condition, code, message):
    if not condition:
        raise NotReady(code, message)


def scripts():
    for name in ('whisper_ui.py', 'whisper_update.py', 'whisper_acceptance.py'):
        operator.secure(Path(__file__).with_name(name))


def previous_transaction(recovery=False):
    check(recovery or not MAINTENANCE.exists(), 'recovery-required',
          'A previous voice maintenance action requires Root recovery')
    path = operator.STATE / 'transaction.json'
    previous = operator.read_record(path) if path.exists() else None
    if previous:
        check(previous.get('phase') in ('restored-verified', 'restored-health-only'),
              'recovery-required', 'Review the existing activation or recovery before another update')
    action_path = operator.STATE / 'ui-action.json'
    if action_path.exists():
        action = operator.read_record(action_path)
        check(recovery or action.get('state') != 'running', 'recovery-required',
              'The previous UI operation was interrupted; Root must reconcile it')


def proof_state(corpus_hash, *, recovery=False):
    scripts()
    previous_transaction(recovery)
    check(hasattr(os, 'setns'), 'preparation-required', 'Python namespace support is required')
    check(operator.DEST.exists(), 'preparation-required', 'The pinned package has not been built')
    build = operator.prepared()
    path = operator.STATE / 'verified.json'
    check(path.exists(), 'preparation-required', 'A successful Root voice verification is required')
    proof = operator.read_record(path)
    check(proof.get('build') == build, 'preparation-required', 'The verified build has changed')
    operator.secure(CORPUS, directory=True)
    corpus = load_corpus(CORPUS, corpus_hash)
    for name in ('baseline', 'candidate'):
        report = proof.get(name, {})
        check(report.get('passed') is True and report.get('manifestSha256') == corpus_hash,
              'preparation-required', 'Voice proof does not match the reviewed corpus')
    check(proof.get('comparison', {}).get('passed') is True, 'preparation-required',
          'The candidate voice comparison did not pass')
    before = operator.live_snapshot(operator.OLD)
    check(proof.get('unitSha256') == operator.digest(before), 'preparation-required',
          'The verified STT unit has changed')
    check(proof.get('oldBinaries') == operator.artifact_hashes(Path(operator.OLD).parent),
          'preparation-required', 'The previous STT binaries have changed')
    check(proof.get('retained') == operator.preserved_state(), 'preparation-required',
          'TTS, model or voice metadata has changed since verification')
    check(not operator.PRIVATE_UNIT.exists(), 'recovery-required',
          'A previous private voice check requires cleanup')
    check(operator.properties(operator.CANDIDATE).get('ActiveState') in ('inactive', 'failed'),
          'recovery-required', 'The private candidate service is still in use')
    return proof, corpus


def requests_clear():
    operator.secure(REQUESTS.parent, directory=True)
    info = REQUESTS.lstat()
    check(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode)
          and info.st_uid == pwd.getpwnam('volition-plan').pw_uid and not info.st_mode & 0o007,
          'preparation-required', 'Native voice admission directory is not installed')
    check(next(REQUESTS.iterdir(), None) is None, 'voice-busy',
          'A transcription is running or its completion needs Root reconciliation')


def authorize(corpus_hash):
    with operator.lock():
        proof, _ = proof_state(corpus_hash)
        now = time.time()
        grant = {'version': operator.VERSION, 'commit': operator.COMMIT,
                 'corpusSha256': corpus_hash, 'proofSha256': operator.digest(
                     json.dumps(proof, sort_keys=True).encode()),
                 'authorizedAt': now, 'expiresAt': now + WINDOW_SECONDS}
        operator.save(operator.STATE / 'ui-window.json', grant)
        return {'version': operator.VERSION, 'expiresAt': grant['expiresAt'],
                'note': 'Root must keep the reviewed GPU/voice window clear until the action finishes'}


def readiness():
    scripts()
    previous_transaction()
    requests_clear()
    check(operator.DEST.exists() and (operator.STATE / 'verified.json').exists(),
          'preparation-required', 'A built and voice-verified package is required')
    path = operator.STATE / 'ui-window.json'
    check(path.exists(), 'maintenance-required', 'A Root-authorized voice maintenance window is required')
    grant = operator.read_record(path)
    now = time.time()
    start, end = grant.get('authorizedAt'), grant.get('expiresAt')
    check(type(start) in (int, float) and type(end) in (int, float)
          and math.isfinite(start) and math.isfinite(end)
          and start <= now < end <= start + WINDOW_SECONDS,
          'maintenance-required', 'The voice maintenance window has expired')
    check(grant.get('version') == operator.VERSION and grant.get('commit') == operator.COMMIT,
          'preparation-required', 'The window is for another package')
    proof, corpus = proof_state(grant.get('corpusSha256'))
    check(grant.get('proofSha256') == operator.digest(json.dumps(proof, sort_keys=True).encode()),
          'preparation-required', 'The authorized voice proof has changed')
    return grant, corpus


@contextlib.contextmanager
def voice_lock(database):
    check(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', database), 'maintenance-required',
          'Invalid database name')
    process = subprocess.Popen(
        ['runuser', '-u', 'postgres', '--', 'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-d', database],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env=operator.ENV, text=True, bufsize=1)
    try:
        process.stdin.write(
            "BEGIN; SET LOCAL idle_in_transaction_session_timeout=0; "
            f"SELECT pg_try_advisory_xact_lock({LOCK_NAMESPACE}, {LOCK_KEY});\n")
        process.stdin.flush()
        ready, _, _ = select.select([process.stdout], [], [], 8)
        check(ready and process.stdout.readline().strip() == 't', 'voice-busy',
              'A transcription is running or the voice admission lock is unavailable')
        def verify():
            check(process.poll() is None, 'recovery-required', 'The voice admission connection was lost')
            process.stdin.write('SELECT 1;\n')
            process.stdin.flush()
            readable, _, _ = select.select([process.stdout], [], [], 8)
            check(readable and process.stdout.readline().strip() == '1', 'recovery-required',
                  'The voice admission connection was lost')
        yield verify
        check(process.poll() is None, 'recovery-required', 'The voice admission connection was lost')
    finally:
        try:
            process.communicate('ROLLBACK;\n', timeout=5)
        except (subprocess.TimeoutExpired, BrokenPipeError):
            process.kill()
            process.wait()


def status():
    result = {'version': operator.VERSION, 'ready': False, 'code': 'preparation-required'}
    try:
        # This never creates files, runs speech checks, or acquires a maintenance window.
        grant, _ = readiness()
        result.update(ready=True, code='ready', expiresAt=grant['expiresAt'])
    except NotReady as error:
        result['code'] = error.code
    except (OSError, RuntimeError, ValueError, KeyError, subprocess.TimeoutExpired):
        pass
    return result


def activate(version, database):
    check(version == operator.VERSION, 'preparation-required', 'Unsupported Whisper target')
    with operator.lock(), voice_lock(database) as verify_admission:
        grant, corpus = readiness()
        # A second read after exclusive admission prevents a stale UI click authorizing new work.
        check(time.time() < grant['expiresAt'], 'maintenance-required', 'The window has expired')
        transaction_path = operator.STATE / 'transaction.json'
        prior_transaction = operator.read_record(transaction_path) if transaction_path.exists() else None
        action = {'version': version, 'actionId': uuid.uuid4().hex, 'state': 'running', 'startedAt': time.time(),
                  'phase': 'baseline-candidate-live-checks', 'window': grant}
        operator.save(operator.STATE / 'ui-action.json', action)
        operator.atomic_write(MAINTENANCE, json.dumps({'version': version, 'actionId': action['actionId']}).encode(), 0o644)
        try:
            requests_clear()
            verify_admission()
            os.replace(operator.STATE / 'ui-window.json', operator.STATE / 'ui-consumed-window.json')
            operator.sync_dir(operator.STATE)
            operator.acceptance(corpus, activate=True)
            transaction = operator.read_record(operator.STATE / 'transaction.json')
            check(transaction.get('phase') == 'active'
                  and transaction.get('createdAt', 0) >= action['startedAt'], 'recovery-required',
                  'Activation did not produce a completed live proof')
            action.update(state='done', phase='active', finishedAt=time.time())
            operator.save(operator.STATE / 'ui-action.json', action)
            finish_maintenance()
            return {'ok': True, 'result': {'from': '1.8.4', 'to': version,
                    'phase': 'active', 'speechVerified': True,
                    'rollbackArtifact': str(operator.STATE / 'transaction.json')}}
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
            path = operator.STATE / 'transaction.json'
            transaction = operator.read_record(path) if path.exists() else {}
            phase = ('not-activated' if transaction == (prior_transaction or {}) else
                     transaction.get('phase', 'recovery-required')
                     if transaction.get('createdAt', 0) >= action['startedAt'] else 'recovery-required')
            action.update(state='failed', phase=phase, finishedAt=time.time())
            operator.save(operator.STATE / 'ui-action.json', action)
            if phase in ('restored-verified', 'not-activated'):
                finish_maintenance()
            return {'ok': False, 'error': f'Whisper update failed: {str(error)[:180]}; recovery state: {phase}',
                    'result': {'phase': phase, 'speechVerified': phase == 'restored-verified',
                               'rollbackArtifact': str(path) if phase != 'not-activated' and path.exists() else None}}


def finish_maintenance():
    check(not operator.PRIVATE_UNIT.exists(), 'recovery-required', 'Private candidate cleanup is incomplete')
    check(operator.properties(operator.CANDIDATE).get('ActiveState') in ('inactive', 'failed'),
          'recovery-required', 'Private candidate is still running')
    marker = operator.read_record(MAINTENANCE)
    action = operator.read_record(operator.STATE / 'ui-action.json')
    check(marker.get('version') == operator.VERSION and marker.get('actionId') == action.get('actionId')
          and isinstance(action.get('actionId'), str), 'recovery-required',
          'Voice maintenance marker belongs to another operation')
    MAINTENANCE.unlink()
    operator.sync_dir(MAINTENANCE.parent)


def resume(corpus_hash):
    # Explicit Root recovery only, after the existing operator rollback/cleanup and speech proof.
    with operator.lock():
        transaction_path = operator.STATE / 'transaction.json'
        transaction = operator.read_record(transaction_path) if transaction_path.exists() else None
        phase = transaction.get('phase') if transaction else 'not-activated'
        check(phase in ('active', 'restored-verified', 'restored-health-only', 'not-activated'), 'recovery-required',
              'Complete and verify operator recovery before resuming voice')
        before = operator.live_snapshot(operator.NEW if phase == 'active' else operator.OLD)
        if phase == 'active':
            check(operator.digest(before) == transaction['afterSha256'], 'recovery-required',
                  'Active unit changed since its speech proof')
        action = operator.read_record(operator.STATE / 'ui-action.json')
        if phase != 'active':
            proof, _ = proof_state(corpus_hash, recovery=True)
            check(proof.get('verifiedAt', 0) > action['startedAt'], 'recovery-required',
                  'A new verified speech check is required after the interrupted action')
        else:
            check(operator.prepared() == transaction['proof']['build'], 'recovery-required',
                  'Active build changed')
            check(operator.preserved_state() == transaction['proof']['retained'], 'recovery-required',
                  'TTS, model or voice metadata changed')
        action.update(state='done' if phase == 'active' else 'failed', phase=phase, finishedAt=time.time())
        operator.save(operator.STATE / 'ui-action.json', action)
        finish_maintenance()
        return {'phase': phase, 'voiceResumed': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('status', 'authorize', 'activate', 'resume'))
    parser.add_argument('--version')
    parser.add_argument('--database', default='itsaplan')
    parser.add_argument('--corpus-sha256')
    args = parser.parse_args()
    check(os.geteuid() == 0, 'preparation-required', 'Root is required')
    if args.action == 'status':
        return {'ok': True, 'result': status()}
    if args.action == 'resume':
        return {'ok': True, 'result': resume(args.corpus_sha256)}
    if args.action == 'authorize':
        return {'ok': True, 'result': authorize(args.corpus_sha256)}
    return activate(args.version, args.database)


if __name__ == '__main__':
    try:
        answer = main()
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        answer = {'ok': False, 'error': str(error)[:300]}
    print(json.dumps(answer))
    raise SystemExit(0 if answer['ok'] else 1)
