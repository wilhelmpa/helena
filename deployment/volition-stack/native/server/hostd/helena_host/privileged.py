"""Revocable root commands. Only units recorded by this broker are stopped."""
from __future__ import annotations

import os
import re
import subprocess
import threading
import time

from .common import HostError, atomic_write_json, iso, json_load_file

LOCK = threading.RLock()
ACTIVE: dict[str, threading.Event] = {}
MAX_SECONDS = 120
MAX_OUTPUT = 65536
ID = re.compile(r'^[a-f0-9]{32}$')


def path(config):
    return os.path.join(config.state_dir, 'volition-root.json')


def state(config):
    return json_load_file(path(config), {'enabled': True, 'directOnly': True, 'epoch': 0, 'units': {}, 'completed': {}})


def settings(ctx, _):
    with LOCK:
        value = state(ctx.config)
        return {key: value[key] for key in ('enabled', 'directOnly', 'epoch')}


def stop(ctx, unit):
    result = ctx.host.run(['systemctl', 'stop', unit], timeout=15)
    if result.returncode and 'not loaded' not in result.stderr and 'not found' not in result.stderr:
        raise HostError('CommandFailed', 'Could not stop a root command')


def configure(ctx, params):
    with LOCK:
        value = state(ctx.config)
        value.update(enabled=params['enabled'], directOnly=params['directOnly'], epoch=value['epoch'] + 1)
        atomic_write_json(path(ctx.config), value)
        units = dict(value['units'])
        active = {unit: ACTIVE.get(unit) for unit in units}
    # Retry until every concurrent StartTransientUnit has returned as well.
    for unit, done in active.items():
        deadline = time.monotonic() + MAX_SECONDS + 30
        while True:
            stop(ctx, unit)
            if done is None or done.wait(0.05):
                stop(ctx, unit)
                break
            if time.monotonic() >= deadline:
                raise HostError('Busy', 'A root command has not stopped yet')
    return settings(ctx, {})


def run(ctx, params):
    request_id = params['id']
    seconds = params['seconds']
    if not ID.fullmatch(request_id) or not 1 <= seconds <= MAX_SECONDS or not params['command'].strip() or len(params['command']) > 4096:
        raise HostError('InvalidParameter', 'Invalid root command or limits')
    unit = 'volition-root-' + request_id + '.service'
    done = threading.Event()
    with LOCK:
        value = state(ctx.config)
        if not value['enabled'] or value['epoch'] != params['epoch']:
            raise HostError('NotAllowed', 'Root access was revoked')
        if len(ACTIVE) >= 4:
            raise HostError('Busy', 'Four root commands are already running')
        if unit in value['units'] or request_id in value.get('completed', []):
            raise HostError('NotAllowed', 'This root request has already been started')
        value['units'][unit] = {'startedAt': iso(ctx.host.now()), 'actor': params.get('actor')}
        atomic_write_json(path(ctx.config), value)
        ACTIVE[unit] = done
    started = iso(ctx.host.now())
    outcome = {'unit': unit, 'exitCode': None, 'output': 'Host helper interrupted', 'startedAt': started}
    try:
        result = ctx.host.run([
            'systemd-run', '--quiet', '--wait', '--pipe', '--collect', '--service-type=exec',
            '--unit=' + unit, '--property=User=root', '--property=KillMode=control-group',
            '--property=TimeoutStopSec=2s', '--property=SendSIGKILL=yes',
            '--property=RuntimeMaxSec=' + str(seconds), '--property=TasksMax=256',
            '--property=MemoryMax=1G', '--', '/bin/sh', '-c', params['command'],
        ], timeout=seconds + 15, output_limit=MAX_OUTPUT)
        outcome = {'unit': unit, 'exitCode': result.returncode, 'output': result.stdout[:MAX_OUTPUT],
                   'startedAt': started, 'finishedAt': iso(ctx.host.now())}
        return outcome
    except subprocess.TimeoutExpired as error:
        output = error.output or b''
        if isinstance(output, bytes):
            output = output.decode('utf-8', 'replace')
        outcome = {'unit': unit, 'exitCode': 124, 'output': (output + '\nRoot command timed out')[:MAX_OUTPUT],
                   'startedAt': started, 'finishedAt': iso(ctx.host.now())}
        return outcome
    finally:
        try:
            stop(ctx, unit)
        finally:
            with LOCK:
                try:
                    value = state(ctx.config)
                    value['units'].pop(unit, None)
                    outcome['finishedAt'] = iso(ctx.host.now())
                    value.setdefault('completed', {})[request_id] = outcome
                    atomic_write_json(path(ctx.config), value)
                finally:
                    ACTIVE.pop(unit, None)
                    done.set()


def result(ctx, params):
    if not ID.fullmatch(params['id']):
        raise HostError('InvalidParameter', 'Invalid root request id')
    with LOCK:
        return state(ctx.config).get('completed', {}).get(params['id'], {'pending': True})
