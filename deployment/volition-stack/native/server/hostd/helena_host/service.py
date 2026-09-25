"""The operations of io.helena.hostd: a fixed list, each with the parameters it accepts and
their types. Anything else is refused before a handler runs. Every operation that changes
the machine is written to the audit log (who, what, the result; never a password)."""

from __future__ import annotations

import json
import os
import pwd
import re
import threading
from dataclasses import dataclass
from typing import Callable

from . import backup, events, guard, power, storage, system
from .common import VERSION, Host, HostError, iso
from .config import GUARD_LIMIT_RANGE, Config, load_settings, save_settings
from .varlink import VarlinkError

INTERFACE = 'io.helena.hostd'
AUDIT_MAX = 1_048_576
ACTOR = re.compile(r'^[\x20-\x7e]{1,128}$')

DESCRIPTION = """# Helena's host helper: the disks and the RAID, backups, power and fans of the machine
# Helena runs on. Only the API's user may call it. Every method answers (result: object).
interface io.helena.hostd

method Capabilities() -> (result: object)
method SystemStatus() -> (result: object)
method StorageStatus(fresh: ?bool) -> (result: object)
method StartRaidCheck(array: string, actor: ?string) -> (result: object)
method StopRaidCheck(array: string, actor: ?string) -> (result: object)
method StartSelfTest(disk: string, actor: ?string) -> (result: object)
method SetBootNextReserve(actor: ?string) -> (result: object)
method ClearBootNext(actor: ?string) -> (result: object)
method PowerStatus(fresh: ?bool) -> (result: object)
method SetPowerProfile(profile: string, actor: ?string) -> (result: object)
method SetFans(mode: string, level: ?int, actor: ?string) -> (result: object)
method SetGuard(limit: int, actor: ?string) -> (result: object)
method BackupStatus() -> (result: object)
method BackupSnapshots() -> (result: object)
method BackupList(snapshot: string, path: string) -> (result: object)
method RunBackup(kind: string, actor: ?string) -> (result: object)
method SetBackupSettings(schedule: ?object, retention: ?object, checkWeekly: ?bool, restoreTestMonthly: ?bool, actor: ?string) -> (result: object)
method StartRestore(snapshot: string, path: string, mode: ?string, confirm: ?string, actor: ?string) -> (result: object)
method RestoreStatus(id: string) -> (result: object)
method RevealBackupPassword(actor: ?string) -> (result: object)
method AcknowledgeBackupPassword(actor: ?string) -> (result: object)
method SetBackupTarget(id: string, kind: string, repository: string, enabled: ?bool, credentials: ?object, actor: ?string) -> (result: object)
method RemoveBackupTarget(id: string, actor: ?string) -> (result: object)
method Events(limit: ?int) -> (result: object)
method MarkEventsSeen(upTo: int, actor: ?string) -> (result: object)

error InvalidParameter (parameter: string, message: string)
error NotFound (message: string)
error NotAllowed (message: string)
error NotAvailable (message: string)
error NotSupported (message: string)
error Busy (message: string)
error CommandFailed (message: string)
error CheckFailed (message: string)
error WriteFailed (message: string)
error Config (message: string)
error Internal (message: string)
"""

TYPES: dict[str, Callable[[object], bool]] = {
    'string': lambda v: isinstance(v, str) and len(v) <= 4096,
    'int': lambda v: isinstance(v, int) and not isinstance(v, bool),
    'bool': lambda v: isinstance(v, bool),
    'object': lambda v: isinstance(v, dict),
}


@dataclass
class Method:
    handler: Callable[['Context', dict], dict]
    params: dict[str, tuple[str, bool]]
    mutating: bool = False
    # Parameters left out of the audit log (secrets).
    secret: tuple[str, ...] = ()


@dataclass
class Context:
    host: Host
    config: Config
    caller: dict


def _p(**spec: str) -> dict[str, tuple[str, bool]]:
    """name='type' is required, name='?type' optional."""
    return {name: (kind.lstrip('?'), not kind.startswith('?')) for name, kind in spec.items()}


# ── Handlers ─────────────────────────────────────────────────────────────────────────────

def capabilities(ctx: Context, _: dict) -> dict:
    host, config = ctx.host, ctx.config
    has_md = any(re.match(r'^md\d+$', name) for name in host.listdir('/sys/block'))
    return {
        'version': VERSION,
        'system': True,
        'storage': {'raid': has_md, 'smart': host.which('smartctl') is not None,
                    'efi': host.exists('/sys/firmware/efi') and host.which('efibootmgr') is not None},
        'backup': {'installed': backup.installed(host, config), 'initialized': backup.initialized(config)},
        'power': {
            'ec': power.ec_available(host, config.power),
            'os': host.which('powerprofilesctl') is not None,
            'ryzenadj': power.ryzenadj_path(host, config.power) is not None,
        },
    }


def power_status(ctx: Context, params: dict) -> dict:
    if params.get('fresh'):
        power._ryzenadj_cache.pop('info', None)
    return power.status(ctx.host, ctx.config.power, load_settings(ctx.config),
                        power.read_guard_state(ctx.config.state_dir))


def set_power_profile(ctx: Context, params: dict) -> dict:
    result = power.set_profile(ctx.host, ctx.config.power, params['profile'])
    settings = load_settings(ctx.config)
    settings['power']['profile'] = params['profile']
    save_settings(ctx.config, settings)
    return result


def set_fans(ctx: Context, params: dict) -> dict:
    if not power.ec_available(ctx.host, ctx.config.power):
        raise HostError('NotAvailable', 'fan control is not available on this machine')
    mode, level = power.validate_fans(params.get('mode'), params.get('level'))
    settings = load_settings(ctx.config)
    settings['power']['fans'] = {'mode': mode, 'level': level}
    save_settings(ctx.config, settings)
    guard_state = power.read_guard_state(ctx.config.state_dir) or {}
    if guard_state.get('active') and guard.guard_needed(settings['power']['fans']):
        # The guard holds the fans at 5 while the CPU is hot; the lower level follows when
        # it has cooled down.
        return {'mode': mode, 'level': level, 'applied': False, 'guardActive': True}
    power.apply_fans(ctx.host, ctx.config.power, mode, level)
    return {'mode': mode, 'level': level, 'applied': True, 'guardActive': bool(guard_state.get('active'))}


def set_guard(ctx: Context, params: dict) -> dict:
    limit = params['limit']
    low, high = GUARD_LIMIT_RANGE
    if not low <= limit <= high:
        raise HostError('InvalidParameter', f'limit must be {low}–{high}', parameter='limit')
    settings = load_settings(ctx.config)
    settings['guard']['limit'] = limit
    settings['guard']['releaseBelow'] = min(settings['guard'].get('releaseBelow', 80), limit - 5)
    save_settings(ctx.config, settings)
    return settings['guard']


def backup_status(ctx: Context, _: dict) -> dict:
    status = backup.status(ctx.host, ctx.config)
    status['history'] = backup.history(ctx.config)[-30:]
    status['restores'] = backup.list_restores(ctx.config)
    return status


def events_list(ctx: Context, params: dict) -> dict:
    limit = params.get('limit') or 100
    if not 1 <= limit <= 500:
        raise HostError('InvalidParameter', 'limit must be 1–500', parameter='limit')
    return events.listing(ctx.config.state_dir, limit=limit)


def mark_seen(ctx: Context, params: dict) -> dict:
    return {'seenUpTo': events.mark_seen(ctx.config.state_dir, params['upTo'])}


def storage_status(ctx: Context, params: dict) -> dict:
    return storage.status(ctx.host, ctx.config.storage, fresh=bool(params.get('fresh')))


storage_lock = threading.Lock()


def _locked(lock: threading.Lock, fn: Callable[[Context, dict], dict]) -> Callable[[Context, dict], dict]:
    def run(ctx: Context, params: dict) -> dict:
        with lock:
            return fn(ctx, params)
    return run


METHODS: dict[str, Method] = {
    'Capabilities': Method(capabilities, {}),
    'SystemStatus': Method(lambda ctx, _: system.status(ctx.host), {}),
    'StorageStatus': Method(storage_status, _p(fresh='?bool')),
    'StartRaidCheck': Method(_locked(storage_lock, lambda ctx, p: storage.start_check(ctx.host, p['array'])),
                             _p(array='string', actor='?string'), mutating=True),
    'StopRaidCheck': Method(_locked(storage_lock, lambda ctx, p: storage.stop_check(ctx.host, p['array'])),
                            _p(array='string', actor='?string'), mutating=True),
    'StartSelfTest': Method(_locked(storage_lock, lambda ctx, p: storage.start_self_test(ctx.host, p['disk'])),
                            _p(disk='string', actor='?string'), mutating=True),
    'SetBootNextReserve': Method(_locked(storage_lock, lambda ctx, p: storage.set_boot_next_reserve(
        ctx.host, ctx.config.storage.get('reserveBootLabel') or 'Debian (Reserve)')),
        _p(actor='?string'), mutating=True),
    'ClearBootNext': Method(_locked(storage_lock, lambda ctx, p: storage.clear_boot_next(ctx.host)),
                            _p(actor='?string'), mutating=True),
    'PowerStatus': Method(power_status, _p(fresh='?bool')),
    'SetPowerProfile': Method(set_power_profile, _p(profile='string', actor='?string'), mutating=True),
    'SetFans': Method(set_fans, _p(mode='string', level='?int', actor='?string'), mutating=True),
    'SetGuard': Method(set_guard, _p(limit='int', actor='?string'), mutating=True),
    'BackupStatus': Method(backup_status, {}),
    'BackupSnapshots': Method(lambda ctx, _: {'snapshots': backup.snapshots(ctx.host, ctx.config)}, {}),
    'BackupList': Method(lambda ctx, p: backup.list_dir(ctx.host, ctx.config, p['snapshot'], p['path']),
                         _p(snapshot='string', path='string')),
    'RunBackup': Method(lambda ctx, p: backup.run(ctx.host, p['kind']), _p(kind='string', actor='?string'),
                        mutating=True),
    'SetBackupSettings': Method(lambda ctx, p: backup.set_settings(ctx.host, ctx.config, p),
                                _p(schedule='?object', retention='?object', checkWeekly='?bool',
                                   restoreTestMonthly='?bool', actor='?string'), mutating=True),
    'StartRestore': Method(lambda ctx, p: backup.start_restore(ctx.host, ctx.config, p),
                           _p(snapshot='string', path='string', mode='?string', confirm='?string',
                              actor='?string'), mutating=True),
    'RestoreStatus': Method(lambda ctx, p: backup.restore_status(ctx.config, p['id']), _p(id='string')),
    'RevealBackupPassword': Method(lambda ctx, p: backup.reveal_password(ctx.config), _p(actor='?string'),
                                   mutating=True),
    'AcknowledgeBackupPassword': Method(lambda ctx, p: backup.acknowledge_password(ctx.config),
                                        _p(actor='?string'), mutating=True),
    'SetBackupTarget': Method(lambda ctx, p: backup.set_target(ctx.config, p),
                              _p(id='string', kind='string', repository='string', enabled='?bool',
                                 credentials='?object', actor='?string'), mutating=True,
                              secret=('credentials',)),
    'RemoveBackupTarget': Method(lambda ctx, p: backup.remove_target(ctx.config, p['id']),
                                 _p(id='string', actor='?string'), mutating=True),
    'Events': Method(events_list, _p(limit='?int')),
    'MarkEventsSeen': Method(mark_seen, _p(upTo='int', actor='?string'), mutating=True),
}


def check_parameters(name: str, method: Method, params: dict) -> None:
    unknown = set(params) - set(method.params)
    if unknown:
        raise HostError('InvalidParameter', f'unexpected parameter {sorted(unknown)[0]}',
                        parameter=sorted(unknown)[0])
    for key, (kind, required) in method.params.items():
        if key not in params or params[key] is None:
            if required:
                raise HostError('InvalidParameter', f'{key} is required', parameter=key)
            params.pop(key, None)
            continue
        if not TYPES[kind](params[key]):
            raise HostError('InvalidParameter', f'{key} must be {kind}', parameter=key)
    actor = params.get('actor')
    if actor is not None and not ACTOR.match(actor):
        raise HostError('InvalidParameter', 'actor is invalid', parameter='actor')


class Dispatcher:
    def __init__(self, host: Host, config: Config, log: Callable[[str], None]):
        self.host = host
        self.config = config
        self.log = log
        self.audit_lock = threading.Lock()

    def authorize(self, uid: int) -> str | None:
        if uid == 0:
            return 'root'
        try:
            name = pwd.getpwuid(uid).pw_name
        except KeyError:
            return None
        return name if name in self.config.callers else None

    def __call__(self, name: str, params: dict, caller: dict) -> dict:
        method = METHODS.get(name)
        if method is None:
            raise VarlinkError('org.varlink.service.MethodNotFound', {'method': f'{INTERFACE}.{name}'})
        params = dict(params)
        try:
            check_parameters(name, method, params)
            result = method.handler(Context(self.host, self.config, caller), params)
            if method.mutating:
                self.audit(name, params, caller, ok=True)
            return {'result': result}
        except HostError as error:
            if method.mutating:
                self.audit(name, params, caller, ok=False, error=error.code)
            raise VarlinkError(f'{INTERFACE}.{error.code}', {'message': error.message, **{
                key: value for key, value in error.parameters.items() if isinstance(value, (str, int, bool))}})

    def audit(self, name: str, params: dict, caller: dict, *, ok: bool, error: str | None = None) -> None:
        method = METHODS[name]
        shown = {key: ('…' if key in method.secret else value) for key, value in params.items() if key != 'actor'}
        entry = {'at': iso(self.host.now()), 'caller': caller.get('name'), 'actor': params.get('actor'),
                 'method': name, 'params': shown, 'ok': ok, **({'error': error} if error else {})}
        line = json.dumps(entry, ensure_ascii=False, separators=(',', ':'))
        self.log(f'audit {line}')
        path = os.path.join(self.config.state_dir, 'audit.log')
        with self.audit_lock:
            try:
                os.makedirs(self.config.state_dir, mode=0o700, exist_ok=True)
                if os.path.exists(path) and os.path.getsize(path) > AUDIT_MAX:
                    os.replace(path, path + '.1')
                fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
                with os.fdopen(fd, 'a', encoding='utf-8') as handle:
                    handle.write(line + '\n')
            except OSError as failure:
                self.log(f'could not write the audit log: {failure}')
