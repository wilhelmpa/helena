"""The machine at a glance: name, board, CPU, kernel, uptime, load, and memory. On an APU the
firmware reserves part of the RAM for the GPU (the owner's choice for local models); it is
shown as it is, next to what the system gets. Memory pressure is judged from what is
available and from the kernel's pressure stall information, never from that split."""

from __future__ import annotations

import os
import platform
import re
import json
import subprocess

from .common import Host, atomic_write_json, file_lock, json_load_file

# Pressure: less than this share of the RAM available, or tasks stalled on memory for more
# than this share of the last minute.
LOW_AVAILABLE_SHARE = 0.10
PSI_SOME_AVG60 = 10.0
EVICTION_WINDOW_SECONDS = 300


def _gpu_entries(value: object, gpu: str = '0'):
    if isinstance(value, list):
        for item in value:
            yield from _gpu_entries(item, gpu)
    elif isinstance(value, dict):
        keys = {str(key).lower(): item for key, item in value.items()}
        if ('evicted_time' in keys or 'evicted time' in keys) and ('pid' in keys or 'process_id' in keys):
            yield gpu, keys
        else:
            gpu = str(keys.get('gpu', gpu))
            for item in value.values():
                yield from _gpu_entries(item, gpu)


def gpu_processes(host: Host, state_dir: str | None) -> list[dict] | None:
    tool = host.which('amd-smi')
    if not tool and host.exists('/opt/helena-ai/rocm-10.0.0/bin/amd-smi'):
        tool = host.path('/opt/helena-ai/rocm-10.0.0/bin/amd-smi')
    if not tool:
        return None
    try:
        result = host.run([tool, 'process', '--json'], timeout=5)
        if result.returncode != 0:
            return None
        entries = list(_gpu_entries(json.loads(result.stdout)))
    except (OSError, ValueError, TimeoutError, subprocess.TimeoutExpired):
        return None
    now = host.now()
    counters = {}
    for gpu, entry in entries:
        try:
            pid = int(entry.get('pid', entry.get('process_id')))
            raw = entry.get('evicted_time', entry.get('evicted time'))
            match = re.match(r'^\s*(\d+(?:\.\d+)?)\s*(ms|s|min)?\s*$', str(raw), re.I)
            if pid <= 0 or not match:
                continue
            factor = {'ms': 1, 's': 1000, 'min': 60_000}[(match.group(2) or 'ms').lower()]
            counter = int(float(match.group(1)) * factor)
            counters[f'{gpu}:{pid}'] = (gpu, pid, counter, str(entry.get('name', entry.get('process_name', '')))[:80])
        except (TypeError, ValueError):
            continue
    if not state_dir:
        return [{'gpu': gpu, 'pid': pid, 'name': name, 'evictedTimeMs': counter, 'evictedMs5m': None}
                for gpu, pid, counter, name in counters.values()]
    os.makedirs(state_dir, mode=0o700, exist_ok=True)
    path = os.path.join(state_dir, 'gpu-eviction.json')
    with file_lock(os.path.join(state_dir, 'gpu-eviction.lock')):
        previous = json_load_file(path, {})
        previous = previous if isinstance(previous, dict) else {}
        history = previous.get('history', {})
        history = history if isinstance(history, dict) else {}
        result = []
        next_history = {}
        for key, (gpu, pid, counter, name) in counters.items():
            samples = history.get(key, [])
            valid = []
            for sample in samples if isinstance(samples, list) else []:
                if not isinstance(sample, (list, tuple)) or len(sample) != 2:
                    continue
                at, value = sample
                if (isinstance(at, (int, float)) and isinstance(value, int)
                        and now - EVICTION_WINDOW_SECONDS <= at <= now and value <= counter):
                    valid.append((float(at), value))
            samples = valid
            baseline = samples[0][1] if samples else None
            samples.append((now, counter))
            next_history[key] = samples[-301:]
            result.append({'gpu': gpu, 'pid': pid, 'name': name, 'evictedTimeMs': counter,
                           'evictedMs5m': counter - baseline if baseline is not None else None})
        atomic_write_json(path, {'history': next_history})
    return result


def memory_consumers(host: Host) -> list[dict]:
    result = []
    for pid in host.listdir('/proc'):
        if not pid.isdigit():
            continue
        text = host.read(f'/proc/{pid}/status', 4096) or ''
        name = re.search(r'^Name:\s*(.+)$', text, re.M)
        rss = re.search(r'^VmRSS:\s*(\d+)\s*kB', text, re.M)
        if rss:
            result.append({'pid': int(pid), 'name': (name.group(1) if name else '?')[:80],
                           'rssBytes': int(rss.group(1)) * 1024})
    return sorted(result, key=lambda item: item['rssBytes'], reverse=True)[:5]


def preload_running(host: Host) -> bool:
    tool = host.which('systemctl')
    if not tool:
        return False
    try:
        result = host.run([tool, 'show', '--property=ActiveState', '--value',
                           'helena-ai-preload.service'], timeout=3)
        return result.returncode == 0 and result.stdout.strip() == 'activating'
    except (OSError, subprocess.TimeoutExpired):
        return False


def meminfo(host: Host) -> dict[str, int]:
    values: dict[str, int] = {}
    for line in (host.read('/proc/meminfo') or '').splitlines():
        match = re.match(r'^(\w+):\s+(\d+)\s*kB', line)
        if match:
            values[match.group(1)] = int(match.group(2)) * 1024
    return values


def pressure(host: Host) -> dict | None:
    text = host.read('/proc/pressure/memory')
    if not text:
        return None
    result = {}
    for line in text.splitlines():
        kind, _, rest = line.partition(' ')
        fields = dict(part.split('=', 1) for part in rest.split() if '=' in part)
        try:
            result[kind] = {'avg10': float(fields['avg10']), 'avg60': float(fields['avg60'])}
        except (KeyError, ValueError):
            continue
    return result or None


def gpu_memory(host: Host) -> dict | None:
    for card in host.listdir('/sys/class/drm'):
        if not re.match(r'^card\d+$', card):
            continue
        base = f'/sys/class/drm/{card}/device'
        total = host.read_int(f'{base}/mem_info_vram_total')
        if total is None:
            continue
        return {
            'vramTotalBytes': total,
            'vramUsedBytes': host.read_int(f'{base}/mem_info_vram_used'),
            'gttTotalBytes': host.read_int(f'{base}/mem_info_gtt_total'),
            'gttUsedBytes': host.read_int(f'{base}/mem_info_gtt_used'),
        }
    return None


def status(host: Host, state_dir: str | None = None) -> dict:
    info = meminfo(host)
    psi = pressure(host)
    total = info.get('MemTotal')
    available = info.get('MemAvailable')
    under_pressure = False
    if total and available is not None and available < total * LOW_AVAILABLE_SHARE:
        under_pressure = True
    if psi and psi.get('some', {}).get('avg60', 0) > PSI_SOME_AVG60:
        under_pressure = True
    uptime_text = host.read('/proc/uptime', 64) or ''
    load_text = host.read('/proc/loadavg', 128) or ''
    cpu_model = None
    for line in (host.read('/proc/cpuinfo', 65536) or '').splitlines():
        if line.startswith('model name'):
            cpu_model = line.split(':', 1)[1].strip()
            break
    try:
        uptime = int(float(uptime_text.split()[0]))
    except (ValueError, IndexError):
        uptime = None
    try:
        load = [float(value) for value in load_text.split()[:3]]
    except ValueError:
        load = []

    def dmi(name: str) -> str | None:
        value = host.read(f'/sys/class/dmi/id/{name}', 256)
        return value.strip() if value and value.strip() else None

    return {
        'hostname': platform.node() if host.root == '/' else (host.read('/etc/hostname', 256) or '').strip(),
        'kernel': platform.release() if host.root == '/' else None,
        'boardVendor': dmi('board_vendor'),
        'boardName': dmi('board_name'),
        'productName': dmi('product_name'),
        'cpuModel': cpu_model,
        'cpuCount': os.cpu_count() if host.root == '/' else None,
        'uptimeSeconds': uptime,
        'load': load,
        'memory': {
            'totalBytes': total,
            'availableBytes': available,
            'swapTotalBytes': info.get('SwapTotal'),
            'swapFreeBytes': info.get('SwapFree'),
            'pressure': psi,
            'underPressure': under_pressure,
        },
        'gpuMemory': gpu_memory(host),
        'gpuProcesses': gpu_processes(host, state_dir),
        'memoryConsumers': memory_consumers(host),
        'localAiPreloadRunning': preload_running(host),
        'efi': host.exists('/sys/firmware/efi'),
    }
