"""Durable, fenced maintenance of the shared GPU service group."""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from urllib.request import Request, urlopen

from .common import Host, HostError, atomic_write_json, file_lock

DIRECTORY = '/var/lib/volition/model-maintenance'
SERVERS = {'halogen': 'helena-halogen.service', 'lemonade': 'lemond.service'}
COMPANIONS = ('helena-embed.service', 'helena-voice-stt.service', 'helena-voice-tts.service')
NPU_UNIT = 'volition-npu.service'
NPU_SOCKETS = ('volition-npu-proxy.socket', 'volition-npu-proxy.service')
NPU_MODELS = {'qwen3.5:4b': 7 * 1024**3, 'qwen3.5:2b': 5 * 1024**3,
              'gemma4-it:e2b': 7 * 1024**3, 'gemma4-it:e4b': 10 * 1024**3}
RESERVE = 12 * 1024**3
GPU_27B_BUDGET = 28 * 1024**3

SOCKETS = ('helena-ai-proxy.socket', 'helena-voice-stt-proxy.socket', 'helena-voice-tts-proxy.socket')
PROXIES = tuple(unit.replace('.socket', '.service') for unit in SOCKETS)
UNITS = (*SERVERS.values(), *COMPANIONS, 'helena-ai-preload.service', *PROXIES)
FORWARD = ('drain', 'pause', 'block-starts', 'stop', 'free-gpu', 'start', 'health', 'probe', 'commit', 'release', 'eval', 'done')
REVERSE = ('rollback-pause', 'rollback-block', 'rollback-stop', 'rollback-free', 'rollback-start', 'rollback-health', 'rollback-probe', 'rollback-commit', 'rollback-release', 'rolled-back')
BARRIERS = {'drain', 'commit', 'eval', 'rollback-commit'}
TERMINAL = {'done', 'rolled-back'}


def paths(host: Host):
    directory = host.path(DIRECTORY)
    os.makedirs(directory, mode=0o755, exist_ok=True)
    return directory + '/state.json', directory + '/maintenance.lock'


def state(host: Host) -> dict:
    path, _ = paths(host)
    try:
        with open(path) as handle:
            value = json.load(handle)
        if value.get('version') != 1 or (value.get('active') is not None and value['active'].get('server') not in SERVERS):
            raise ValueError('invalid state')
        return value
    except FileNotFoundError:
        return {'version': 1, 'active': None, 'operation': None, 'admissionPaused': False,
                'proxyPaused': False, 'startsBlocked': False, 'allowedStarts': []}
    except (OSError, ValueError, AttributeError) as error:
        raise HostError('CheckFailed', 'Model maintenance state is unreadable') from error


def save(host: Host, value: dict):
    path, _ = paths(host)
    atomic_write_json(path, value, mode=0o644)
    fd = os.open(os.path.dirname(path), os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def journal(host: Host, value: dict, event: str):
    op = value['operation']
    entry = {'at': host.now(), 'id': op['id'], 'phase': op['phase'], 'event': event}
    op['journal'].append(entry)
    save(host, value)
    print('volition-model-maintenance ' + json.dumps(entry), flush=True)


def validate_target(target):
    if not isinstance(target, dict) or not {'server', 'model', 'slug'} <= set(target) or set(target) - {'server', 'model', 'slug', 'profile', 'npu'}:
        raise HostError('InvalidParameter', 'Expected server, model and slug', parameter='target')
    if target['server'] not in SERVERS or not all(isinstance(target[k], str) and re.fullmatch(r'[A-Za-z0-9_.:/-]{1,200}', target[k]) for k in ('model', 'slug')):
        raise HostError('InvalidParameter', 'Unsupported model target', parameter='target')
    if target.get('profile') not in (None, 'local-halogen', 'local-27b-npu'):
        raise HostError('InvalidParameter', 'Unknown local profile', parameter='target')
    if target.get('profile') == 'local-halogen' and (target['server'] != 'halogen' or target.get('npu')):
        raise HostError('InvalidParameter', 'Halogen runs without NPU', parameter='target')
    if target.get('profile') == 'local-27b-npu' and (target['server'] != 'lemonade' or target['model'] != 'Qwen3.8-27B-GGUF' or target.get('npu') not in NPU_MODELS):
        raise HostError('InvalidParameter', '27B requires a small NPU model', parameter='target')
    if target.get('npu') and target.get('profile') != 'local-27b-npu':
        raise HostError('InvalidParameter', 'NPU requires the paired profile', parameter='target')
    return dict(target)


def memory(host):
    raw = host.read('/proc/meminfo') or ''
    values = {key: int(value) * 1024 for key, value in re.findall(r'^(MemAvailable|Mlocked|MemTotal):\s+(\d+) kB', raw, re.M)}
    if len(values) != 3:
        raise HostError('CheckFailed', 'Cannot read memory budget')
    return values


def select_npu(host, previous, requested=None):
    values = memory(host)
    # Estimate Halogen's released lock; startup rechecks actual free memory.
    reclaim = min(values['Mlocked'], 72 * 1024**3) if previous['server'] == 'halogen' else 0
    budget = min(values['MemTotal'], values['MemAvailable'] + reclaim) - RESERVE
    if previous['server'] != 'lemonade' or previous['model'] != 'Qwen3.8-27B-GGUF':
        budget -= GPU_27B_BUDGET
    installed = json.loads(host.read('/var/lib/volition-npu/installed.json') or '{}').get('models', [])
    tags = {row.get('name') for row in installed}
    if requested:
        if requested in tags and 'embed-gemma:300m' in tags and budget >= NPU_MODELS[requested]:
            return requested
        raise HostError('CheckFailed', 'Requested NPU model is unavailable or exceeds memory')
    for model, footprint in NPU_MODELS.items():
        if budget >= footprint and model in tags and 'embed-gemma:300m' in tags:
            return model
    raise HostError('CheckFailed', 'No installed small NPU model fits without swap')


def may_start(host: Host, unit: str) -> bool:
    value = state(host)
    if value['startsBlocked']:
        return unit in value['allowedStarts']
    active = value['active']
    if unit in (NPU_UNIT, *NPU_SOCKETS):
        return bool(active and active.get('npu'))
    if active and unit in SERVERS.values():
        return unit == SERVERS[active['server']]
    if active and active['server'] != 'lemonade' and unit in ('helena-ai-preload.service', *SOCKETS[:1], *PROXIES[:1]):
        return False
    return True


class Driver:
    def __init__(self, host: Host):
        self.host = host

    def ctl(self, *args):
        result = self.host.run(['systemctl', *args], timeout=240)
        if result.returncode:
            raise HostError('CommandFailed', 'GPU service operation failed')

    def snapshot(self):
        return [unit for unit in (*COMPANIONS, *SOCKETS) if self.host.run(
            ['systemctl', 'is-active', '--quiet', unit], timeout=10).returncode == 0]

    def http(self, target, path, body=None):
        base = 'http://127.0.0.1:8731' if target['server'] == 'halogen' else 'http://127.0.0.1:13305/api/v1'
        headers = {'Content-Type': 'application/json'}
        if target['server'] == 'lemonade':
            key = self.host.read('/etc/helena/local-ai.key')
            if not key:
                raise HostError('NotAvailable', 'Lemonade credential unavailable')
            headers['Authorization'] = 'Bearer ' + key.strip()
        request = Request(base + path, data=json.dumps(body).encode() if body else None, headers=headers)
        with urlopen(request, timeout=180) as response:
            return json.load(response)

    def perform(self, phase, target, value):
        op = value['operation']
        if phase == 'pause':
            deadline = time.monotonic() + 180
            while True:
                with urlopen('http://127.0.0.1:8741/priority/status', timeout=5) as response:
                    status = json.load(response)
                if status.get('administrativePaused') and not any(status['active'].values()):
                    break
                if time.monotonic() >= deadline:
                    raise HostError('Busy', 'Priority proxy has not drained')
                self.host.sleep(.2)
        elif phase == 'stop':
            # Stop sockets first in the same systemd transaction as every GPU consumer.
            if target.get('profile') or op['previous'].get('npu') or op.get('target', {}).get('npu'):
                self.ctl('stop', *NPU_SOCKETS, NPU_UNIT)
            self.ctl('stop', *SOCKETS, *UNITS)
        elif phase == 'free-gpu':
            for proc in Path(self.host.path('/proc')).glob('[0-9]*'):
                try:
                    if any(os.readlink(fd) == '/dev/kfd' for fd in (proc / 'fd').iterdir()):
                        raise HostError('Busy', 'GPU contexts are still in use')
                except (FileNotFoundError, ProcessLookupError):
                    continue
        elif phase == 'start':
            if memory(self.host)['MemAvailable'] < RESERVE:
                raise HostError('CheckFailed', 'GPU memory reserve is unavailable')
            if target.get('npu') and memory(self.host)['MemAvailable'] < RESERVE + GPU_27B_BUDGET + NPU_MODELS[target['npu']]:
                raise HostError('CheckFailed', 'GPU/NPU pair exceeds available memory')
            self.ctl('start', SERVERS[target['server']])
        elif phase == 'health':
            deadline = time.monotonic() + 240
            while True:
                try:
                    data = self.http(target, '/health')
                    engine = data.get('engine')
                    responds = engine.get('responds') if isinstance(engine, dict) else data.get('responds')
                    if target['server'] != 'halogen' or (data.get('status') == 'ok' and responds is True):
                        if target.get('profile') == 'local-27b-npu':
                            catalog = self.http(target, '/models?show_all=true')
                            model = next((row for row in catalog.get('data', []) if row.get('id') == target['model']), None)
                            if model is None:
                                raise ValueError('Waiting for the local model catalog')
                            if model.get('downloaded') is not True:
                                raise HostError('CheckFailed', 'The profile model must already be downloaded')
                        break
                except (OSError, ValueError):
                    pass
                if time.monotonic() >= deadline:
                    raise HostError('CheckFailed', 'Model server health failed')
                self.host.sleep(2)
        elif phase == 'probe':
            data = self.http(target, '/v1/chat/completions' if target['server'] == 'halogen' else '/chat/completions', {
                'model': target['model'], 'messages': [{'role': 'user', 'content': 'Call volition_probe with ok=true.'}],
                'tools': [{'type': 'function', 'function': {'name': 'volition_probe', 'parameters': {
                    'type': 'object', 'properties': {'ok': {'type': 'boolean'}}, 'required': ['ok']}}}],
                'tool_choice': {'type': 'function', 'function': {'name': 'volition_probe'}}, 'max_tokens': 512,
            })
            calls = data.get('choices', [{}])[0].get('message', {}).get('tool_calls', [])
            if not any(call.get('function', {}).get('name') == 'volition_probe' and
                       json.loads(call['function']['arguments']) == {'ok': True} for call in calls):
                raise HostError('CheckFailed', 'Model tool probe failed')
            if target.get('npu'):
                model = target['npu']
                self.ctl('stop', NPU_UNIT)
                if memory(self.host)['MemAvailable'] < RESERVE + NPU_MODELS[model]:
                    raise HostError('CheckFailed', 'NPU memory reserve is unavailable')
                atomic_write_json(self.host.path('/var/lib/volition-npu/model.json'), {'model': model}, mode=0o644)
                self.ctl('start', NPU_UNIT)
                deadline = time.monotonic() + 240
                while True:
                    try:
                        request = Request('http://127.0.0.1:13310/v1/chat/completions', headers={
                            'Content-Type': 'application/json'},
                            data=json.dumps({'model': model, 'messages': [{'role': 'user', 'content': 'Reply OK'}], 'max_tokens': 16}).encode())
                        with urlopen(request, timeout=180) as response:
                            if not json.load(response).get('choices'):
                                raise ValueError('Empty NPU response')
                        break
                    except (OSError, ValueError):
                        if time.monotonic() >= deadline:
                            raise HostError('CheckFailed', 'NPU probe failed')
                        self.host.sleep(2)
        elif phase == 'release':
            if target.get('npu'):
                self.ctl('start', NPU_SOCKETS[0])
            for unit in op['companions']:
                if unit == 'helena-ai-proxy.socket' and target['server'] != 'lemonade':
                    continue
                # Voice workers are demand-started only after successful model verification.
                unit = unit.replace('.service', '-proxy.socket') if unit.startswith('helena-voice-') and unit.endswith('.service') else unit
                self.ctl('start', unit)


def switch(host: Host, params: dict, driver=None) -> dict:
    driver = driver or Driver(host)
    _, lock = paths(host)
    with file_lock(lock, blocking=False) as acquired:
        if not acquired:
            raise HostError('Busy', 'GPU maintenance is already running')
        value = state(host)
        op = value['operation']
        action = params.get('action', 'advance')
        identity = params['id']
        if not re.fullmatch(r'[a-zA-Z0-9-]{1,80}', identity):
            raise HostError('InvalidParameter', 'Invalid operation id', parameter='id')
        if action == 'begin':
            if op and op['id'] == identity:
                if op['target'] != params['target']:
                    raise HostError('InvalidParameter', 'Operation target cannot change', parameter='target')
                return value
            if op and op['phase'] not in TERMINAL:
                raise HostError('Busy', 'Resume the pending model operation')
            target = validate_target(params['target'])
            previous = value['active'] or validate_target(params['previous'])
            if target.get('profile') == 'local-27b-npu':
                target['npu'] = select_npu(host, previous, target.get('npu'))
            if not value['active']:
                if host.run(['systemctl', 'is-active', '--quiet', SERVERS[previous['server']]], timeout=10).returncode:
                    raise HostError('CheckFailed', 'Previous model server is not active')
                other = SERVERS['lemonade' if previous['server'] == 'halogen' else 'halogen']
                if host.run(['systemctl', 'is-active', '--quiet', other], timeout=10).returncode == 0:
                    raise HostError('CheckFailed', 'Both model servers are active')
            value.update(active=previous, admissionPaused=True, operation={
                'id': identity, 'target': target, 'previous': previous, 'phase': 'drain',
                'companions': driver.snapshot(), 'journal': [], 'error': None})
            journal(host, value, 'begin')
            return value
        if not op or op['id'] != identity:
            raise HostError('NotFound', 'No such model operation')
        if action == 'rollback' and op['phase'] not in REVERSE:
            value.update(admissionPaused=True, proxyPaused=True, startsBlocked=True, allowedStarts=[])
            op['phase'] = 'rollback-pause'
            journal(host, value, 'rollback')
        phase = op['phase']
        if phase in TERMINAL:
            return value
        if params.get('expected') != phase:
            return value
        if phase in BARRIERS and params.get('ack') != phase:
            return value
        reverse = phase.startswith('rollback-')
        target = op['previous'] if reverse else op['target']
        base = {'rollback-block': 'block-starts', 'rollback-free': 'free-gpu'}.get(phase, phase.removeprefix('rollback-'))
        if base == 'pause':
            value['proxyPaused'] = True
        if base == 'block-starts':
            value.update(startsBlocked=True, allowedStarts=[])
        if base == 'start':
            value['allowedStarts'] = [SERVERS[target['server']]] + ([NPU_UNIT] if target.get('npu') else [])
        if base == 'release':
            value.update(startsBlocked=False, allowedStarts=[])
        journal(host, value, 'started')
        try:
            driver.perform(base, target, value)
            if base == 'commit':
                value['active'] = target
            if base == 'release':
                value.update(admissionPaused=False, proxyPaused=False)
            order = REVERSE if reverse else FORWARD
            op['phase'] = order[order.index(phase) + 1]
            op['error'] = None
            journal(host, value, 'completed')
        except Exception:
            op['error'] = 'Maintenance step failed; resume or restore previous model'
            value.update(admissionPaused=True, proxyPaused=True, startsBlocked=True, allowedStarts=[])
            op['phase'] = phase if reverse else 'rollback-pause'
            journal(host, value, 'failed')
        return value


def reset_group(host: Host, driver=None):
    """A reset invalidates all checks; the API resumes the durable rollback barriers."""
    driver = driver or Driver(host)
    _, lock = paths(host)
    with file_lock(lock) as acquired:
        value = state(host)
        value.update(admissionPaused=True, proxyPaused=True, startsBlocked=True, allowedStarts=[])
        save(host, value)
        if not value['active']:
            value['active'] = discover_active(host, driver)
        op = value['operation']
        if not op or op['phase'] in TERMINAL:
            value['operation'] = {'id': 'reset-' + str(time.time_ns()), 'target': value['active'],
                'previous': value['active'], 'phase': 'drain', 'companions': driver.snapshot(), 'journal': [], 'error': None}
        else:
            op['phase'] = 'rollback-pause'
        value.update(admissionPaused=True, proxyPaused=True, startsBlocked=True, allowedStarts=[])
        journal(host, value, 'gpu-reset')
        return value


def discover_active(host: Host, driver: Driver) -> dict:
    active = [kind for kind, unit in SERVERS.items() if host.run(
        ['systemctl', 'is-active', '--quiet', unit], timeout=10).returncode == 0]
    if len(active) != 1:
        raise HostError('CheckFailed', 'Cannot identify the active model server')
    target = {'server': active[0], 'slug': 'halogen' if active[0] == 'halogen' else 'local', 'model': ''}
    if active[0] == 'halogen':
        loaded = [item['id'] for item in driver.http(target, '/v1/models')['data']]
    else:
        health = driver.http(target, '/health')
        loaded = [item.get('model_name') or item.get('id') for item in health.get('all_models_loaded', [])]
        if health.get('model_loaded'):
            loaded.append(health['model_loaded'])
    loaded = list(set(filter(None, loaded)))
    if len(loaded) != 1:
        raise HostError('CheckFailed', 'Cannot identify the active model')
    target['model'] = loaded[0]
    return validate_target(target)


def initialize(host: Host, driver=None) -> dict:
    _, lock = paths(host)
    with file_lock(lock) as acquired:
        value = state(host)
        if not value['active']:
            value['active'] = discover_active(host, driver or Driver(host))
            save(host, value)
        return value
