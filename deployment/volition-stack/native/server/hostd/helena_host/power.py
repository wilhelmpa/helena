"""Power and fans: three layers per profile, each shown on its own so the owner sees what is
really active.

1. The EC ("BIOS performance"): /sys/class/ec_su_axb35/apu/power_mode quiet|balanced|
   performance, the vendor's own power limits (Sixunited AXB35 wiki: STAPM/fast/slow
   54/100/54 W, 85/120/120 W, 120/140/120 W).
2. The OS: power-profiles-daemon's power-saver|balanced|performance (amd-pstate EPP).
3. Optional ryzenadj limits per profile, read back with `ryzenadj -i`. An EC mode change
   resets them, so they are applied after it and never above the mode's own limits.

Fans: all three EC fans together, "auto" (the EC's own curve) or fixed levels 1–5
(20 %…100 %). A thermal guard (guard.py) raises fixed fans to 5 when the CPU stays hot."""

from __future__ import annotations

import os
import re
import threading

from .common import Host, HostError, clip, json_load_file

PROFILE_LAYERS = {
    'saver': {'ec': 'quiet', 'ppd': 'power-saver'},
    'balanced': {'ec': 'balanced', 'ppd': 'balanced'},
    'performance': {'ec': 'performance', 'ppd': 'performance'},
}
EC_MODE_PROFILE = {layers['ec']: name for name, layers in PROFILE_LAYERS.items()}
PPD_PROFILE = {layers['ppd']: name for name, layers in PROFILE_LAYERS.items()}
# The EC modes' own limits in watts (STAPM, PPT fast, PPT slow), from
# https://strixhalo.wiki/Guides/Sixunited_AXB35/Power_Mode_and_Fan_Control/ (2026-09-24).
EC_LIMITS_W = {
    'quiet': (54, 100, 54),
    'balanced': (85, 120, 120),
    'performance': (120, 140, 120),
}
FANS = ('fan1', 'fan2', 'fan3')
FAN_ROLES = {'fan1': 'cpu', 'fan2': 'cpu', 'fan3': 'system'}
FAN_LEVELS = range(1, 6)
RYZENADJ_TTL = 30.0
RYZENADJ_FIELDS = {
    'STAPM LIMIT': 'stapmLimitW', 'STAPM VALUE': 'stapmValueW',
    'PPT LIMIT FAST': 'fastLimitW', 'PPT VALUE FAST': 'fastValueW',
    'PPT LIMIT SLOW': 'slowLimitW', 'PPT VALUE SLOW': 'slowValueW',
    'THM LIMIT CORE': 'tctlLimitC', 'THM VALUE CORE': 'tctlValueC',
}
RYZENADJ_ROW = re.compile(r'^\|\s*([A-Z0-9 _/-]+?)\s*\|\s*(-?[0-9]+(?:\.[0-9]+)?|nan|-nan)\s*\|')
OVERRIDE_KEYS = {'stapm', 'fast', 'slow', 'tctl'}

power_lock = threading.RLock()
_ryzenadj_cache: dict[str, object] = {}


# ── The EC ───────────────────────────────────────────────────────────────────────────────

def board_name(host: Host) -> str | None:
    text = host.read('/sys/class/dmi/id/board_name', 256)
    return text.strip() if text else None


def ec_available(host: Host, power_config: dict) -> bool:
    root = power_config.get('ecRoot') or '/sys/class/ec_su_axb35'
    boards = power_config.get('ecBoards') or []
    return host.exists(f'{root}/apu/power_mode') and board_name(host) in boards


def _bracketed(text: str | None) -> str | None:
    """sysfs values are plain ("auto") or a choice list with the current one bracketed."""
    if text is None:
        return None
    text = text.strip()
    match = re.search(r'\[([a-z-]+)\]', text)
    return match.group(1) if match else (text or None)


def read_ec(host: Host, power_config: dict) -> dict | None:
    if not ec_available(host, power_config):
        return None
    root = power_config.get('ecRoot') or '/sys/class/ec_su_axb35'
    fans = []
    for fan in FANS:
        if not host.exists(f'{root}/{fan}'):
            continue
        fans.append({
            'id': fan,
            'role': FAN_ROLES[fan],
            'rpm': host.read_int(f'{root}/{fan}/rpm'),
            'mode': _bracketed(host.read(f'{root}/{fan}/mode', 64)),
            'level': host.read_int(f'{root}/{fan}/level'),
        })
    return {
        'powerMode': _bracketed(host.read(f'{root}/apu/power_mode', 64)),
        'temperatureC': host.read_int(f'{root}/temp1/temp'),
        'temperatureMaxC': host.read_int(f'{root}/temp1/max'),
        'fans': fans,
    }


def fans_summary(ec: dict | None) -> dict | None:
    """The fans as one control: `auto`, `fixed` with a level, or `mixed`."""
    if not ec or not ec['fans']:
        return None
    modes = {fan['mode'] for fan in ec['fans']}
    levels = {fan['level'] for fan in ec['fans']}
    if modes == {'auto'}:
        return {'mode': 'auto', 'level': None}
    if modes <= {'fixed'} and len(levels) == 1:
        return {'mode': 'fixed', 'level': next(iter(levels))}
    if modes <= {'curve'}:
        return {'mode': 'curve', 'level': None}
    return {'mode': 'mixed', 'level': None}


def apply_fans(host: Host, power_config: dict, mode: str, level: int | None) -> None:
    root = power_config.get('ecRoot') or '/sys/class/ec_su_axb35'
    with power_lock:
        for fan in FANS:
            if not host.exists(f'{root}/{fan}'):
                continue
            if mode == 'auto':
                host.write_sysfs(f'{root}/{fan}/mode', 'auto')
            else:
                host.write_sysfs(f'{root}/{fan}/mode', 'fixed')
                host.write_sysfs(f'{root}/{fan}/level', str(level))


def validate_fans(mode: object, level: object) -> tuple[str, int | None]:
    if mode not in ('auto', 'fixed'):
        raise HostError('InvalidParameter', 'mode must be auto or fixed', parameter='mode')
    if mode == 'auto':
        if level is not None:
            raise HostError('InvalidParameter', 'auto takes no level', parameter='level')
        return 'auto', None
    if not isinstance(level, int) or isinstance(level, bool) or level not in FAN_LEVELS:
        raise HostError('InvalidParameter', 'level must be 1–5', parameter='level')
    return 'fixed', level


# ── Temperatures (hwmon) ────────────────────────────────────────────────────────────────

def nvme_disk(host: Host, hwmon: str) -> str | None:
    """The block device of an NVMe drive's hwmon: …/nvme/nvme0 → nvme0n1."""
    try:
        controller = os.path.basename(os.path.realpath(host.path(f'{hwmon}/device')))
    except OSError:
        return None
    if not re.match(r'^nvme\d+$', controller):
        return None
    namespaces = [name for name in host.listdir(f'{hwmon}/device') if re.match(rf'^{controller}n\d+$', name)]
    return sorted(namespaces)[0] if namespaces else f'{controller}n1'


def read_temperatures(host: Host) -> list[dict]:
    sensors = []
    for entry in host.listdir('/sys/class/hwmon'):
        base = f'/sys/class/hwmon/{entry}'
        name = (host.read(f'{base}/name', 64) or '').strip()
        if name not in ('k10temp', 'amdgpu', 'nvme', 'acpitz'):
            continue
        for index in range(1, 9):
            value = host.read_int(f'{base}/temp{index}_input')
            if value is None:
                continue
            label = (host.read(f'{base}/temp{index}_label', 64) or '').strip() or None
            if name == 'nvme' and label not in (None, 'Composite'):
                continue
            sensor = {
                'sensor': name,
                'id': f'{entry}/temp{index}',
                'label': label,
                'celsius': round(value / 1000, 1),
            }
            if name == 'nvme':
                sensor['disk'] = nvme_disk(host, base)
            sensors.append(sensor)
        if name == 'amdgpu':
            watts = host.read_int(f'{base}/power1_average') or host.read_int(f'{base}/power1_input')
            if watts is not None:
                sensors.append({'sensor': 'amdgpu', 'id': f'{entry}/power1', 'label': 'PPT',
                                'watts': round(watts / 1_000_000, 1)})
    return sensors


def cpu_temperature(host: Host, power_config: dict) -> float | None:
    """The hottest CPU reading: the EC's sensor and k10temp's Tctl."""
    readings = []
    root = power_config.get('ecRoot') or '/sys/class/ec_su_axb35'
    if ec_available(host, power_config):
        ec_temp = host.read_int(f'{root}/temp1/temp')
        if ec_temp is not None and 0 < ec_temp < 150:
            readings.append(float(ec_temp))
    for sensor in read_temperatures(host):
        if sensor['sensor'] == 'k10temp' and 'celsius' in sensor:
            readings.append(sensor['celsius'])
    return max(readings) if readings else None


# ── The OS profile (power-profiles-daemon) and EPP ─────────────────────────────────────

def read_ppd(host: Host) -> dict | None:
    tool = host.which('powerprofilesctl')
    if not tool:
        return None
    result = host.run([tool, 'get'], timeout=10)
    if result.returncode != 0:
        return {'profile': None, 'error': clip(result.stderr, 200)}
    return {'profile': result.stdout.strip() or None}


def read_cpu(host: Host) -> dict:
    base = '/sys/devices/system/cpu/cpu0/cpufreq'
    return {
        'driver': (host.read(f'{base}/scaling_driver', 64) or '').strip() or None,
        'governor': (host.read(f'{base}/scaling_governor', 64) or '').strip() or None,
        'epp': (host.read(f'{base}/energy_performance_preference', 64) or '').strip() or None,
    }


# ── ryzenadj ─────────────────────────────────────────────────────────────────────────────

def ryzenadj_path(host: Host, power_config: dict) -> str | None:
    path = power_config.get('ryzenadjPath') or '/usr/local/sbin/ryzenadj'
    if host.programs is not None:
        return host.programs.get('ryzenadj')
    return path if os.path.isfile(host.path(path)) and os.access(host.path(path), os.X_OK) else None


def smu_driver_loaded(host: Host) -> bool:
    return host.exists('/sys/kernel/ryzen_smu_drv/pm_table')


def parse_ryzenadj_info(text: str) -> dict:
    values: dict = {}
    family = None
    for line in text.splitlines():
        if line.startswith('CPU Family:'):
            family = line.split(':', 1)[1].strip() or None
        match = RYZENADJ_ROW.match(line)
        if match and match.group(1) in RYZENADJ_FIELDS:
            raw = match.group(2)
            values[RYZENADJ_FIELDS[match.group(1)]] = None if 'nan' in raw else round(float(raw), 1)
    return {'family': family, **values}


def read_ryzenadj(host: Host, power_config: dict, *, fresh: bool = False) -> dict | None:
    path = ryzenadj_path(host, power_config)
    if not path:
        return None
    if not smu_driver_loaded(host):
        return {'available': False, 'reason': 'no_smu_driver'}
    now = host.now()
    cached = _ryzenadj_cache.get('info')
    if cached and not fresh and now - cached[0] < RYZENADJ_TTL:  # type: ignore[index]
        return cached[1]  # type: ignore[index]
    result = host.run([path, '-i'], timeout=15)
    if result.returncode != 0:
        info = {'available': False, 'reason': 'failed', 'error': clip(result.stderr, 200)}
    else:
        info = {'available': True, **parse_ryzenadj_info(result.stdout)}
    _ryzenadj_cache['info'] = (now, info)
    return info


def validate_override(profile: str, override: object) -> dict | None:
    """A configured ryzenadj override, bounded by the EC mode's own limits: Helena never
    raises a limit above what the vendor set for that mode."""
    if override is None:
        return None
    if not isinstance(override, dict) or set(override) - OVERRIDE_KEYS:
        raise HostError('Config', f'the ryzenadj override of {profile} is invalid')
    stapm, fast, slow = (w * 1000 for w in EC_LIMITS_W[PROFILE_LAYERS[profile]['ec']])
    bounds = {'stapm': (15000, stapm), 'fast': (15000, fast), 'slow': (15000, slow), 'tctl': (60, 100)}
    result = {}
    for key, value in override.items():
        low, high = bounds[key]
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            raise HostError('Config', f'the ryzenadj {key} of {profile} must be {low}–{high}')
        result[key] = value
    return result


def apply_ryzenadj(host: Host, power_config: dict, override: dict) -> None:
    path = ryzenadj_path(host, power_config)
    if not path or not smu_driver_loaded(host):
        raise HostError('NotAvailable', 'ryzenadj is not available')
    argv = [path]
    names = {'stapm': 'stapm-limit', 'fast': 'fast-limit', 'slow': 'slow-limit', 'tctl': 'tctl-temp'}
    for key in ('stapm', 'fast', 'slow', 'tctl'):
        if key in override:
            argv.append(f'--{names[key]}={override[key]}')
    result = host.run(argv, timeout=15)
    _ryzenadj_cache.pop('info', None)
    if result.returncode != 0:
        raise HostError('CommandFailed', 'ryzenadj refused the limits')


# ── Profiles ─────────────────────────────────────────────────────────────────────────────

def set_profile(host: Host, power_config: dict, profile: object) -> dict:
    if profile not in PROFILE_LAYERS:
        raise HostError('InvalidParameter', 'profile must be saver, balanced or performance', parameter='profile')
    layers = PROFILE_LAYERS[profile]
    override = validate_override(profile, (power_config.get('overrides') or {}).get(profile))
    results: dict = {}
    with power_lock:
        if ec_available(host, power_config):
            root = power_config.get('ecRoot') or '/sys/class/ec_su_axb35'
            try:
                host.write_sysfs(f'{root}/apu/power_mode', layers['ec'])
                results['ec'] = {'ok': True, 'value': layers['ec']}
            except HostError as error:
                results['ec'] = {'ok': False, 'error': error.message}
        else:
            results['ec'] = {'ok': False, 'error': 'not available'}
        tool = host.which('powerprofilesctl')
        if tool:
            result = host.run([tool, 'set', layers['ppd']], timeout=15)
            results['os'] = {'ok': result.returncode == 0, 'value': layers['ppd'],
                             **({} if result.returncode == 0 else {'error': clip(result.stderr, 200)})}
        else:
            results['os'] = {'ok': False, 'error': 'not available'}
        if override:
            # The EC answers a mode change by writing its own limits; wait for it first.
            host.sleep(1.5)
            try:
                apply_ryzenadj(host, power_config, override)
                results['ryzenadj'] = {'ok': True, 'value': override}
            except HostError as error:
                results['ryzenadj'] = {'ok': False, 'error': error.message}
        _ryzenadj_cache.pop('info', None)
    if not any(layer.get('ok') for layer in results.values()):
        raise HostError('NotAvailable', 'no power layer could be set')
    return {'profile': profile, 'layers': results}


def active_profile(ec: dict | None, ppd: dict | None) -> str | None:
    """The Helena profile the layers show, or `mixed` when they disagree."""
    found = set()
    if ec and ec.get('powerMode') in EC_MODE_PROFILE:
        found.add(EC_MODE_PROFILE[ec['powerMode']])
    if ppd and ppd.get('profile') in PPD_PROFILE:
        found.add(PPD_PROFILE[ppd['profile']])
    if not found:
        return None
    return found.pop() if len(found) == 1 else 'mixed'


def status(host: Host, power_config: dict, settings: dict, guard_state: dict | None) -> dict:
    ec = read_ec(host, power_config)
    ppd = read_ppd(host)
    overrides = {}
    for profile in PROFILE_LAYERS:
        try:
            overrides[profile] = validate_override(profile, (power_config.get('overrides') or {}).get(profile))
        except HostError:
            overrides[profile] = None
    return {
        'available': {
            'ec': ec is not None,
            'os': ppd is not None,
            'ryzenadj': ryzenadj_path(host, power_config) is not None,
            'smuDriver': smu_driver_loaded(host),
        },
        'board': board_name(host),
        'profile': active_profile(ec, ppd),
        'desired': settings.get('power') or {},
        'ec': ec,
        'fans': fans_summary(ec),
        'os': ppd,
        'cpu': read_cpu(host),
        'ryzenadj': read_ryzenadj(host, power_config),
        'profiles': {
            name: {
                'ec': layers['ec'], 'os': layers['ppd'],
                'ecLimitsW': dict(zip(('stapm', 'fast', 'slow'), EC_LIMITS_W[layers['ec']])),
                'override': overrides.get(name),
            }
            for name, layers in PROFILE_LAYERS.items()
        },
        'temperatures': read_temperatures(host),
        'cpuTemperatureC': cpu_temperature(host, power_config),
        'guard': {**(settings.get('guard') or {}), 'state': guard_state or {'active': False}},
    }


def read_guard_state(state_dir: str) -> dict | None:
    value = json_load_file(os.path.join(state_dir, 'guard.json'), None)
    return value if isinstance(value, dict) else None
