"""The machine at a glance: name, board, CPU, kernel, uptime, load, and memory. On an APU the
firmware reserves part of the RAM for the GPU (the owner's choice for local models); it is
shown as it is, next to what the system gets. Memory pressure is judged from what is
available and from the kernel's pressure stall information, never from that split."""

from __future__ import annotations

import os
import platform
import re

from .common import Host

# Pressure: less than this share of the RAM available, or tasks stalled on memory for more
# than this share of the last minute.
LOW_AVAILABLE_SHARE = 0.10
PSI_SOME_AVG60 = 10.0


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


def status(host: Host) -> dict:
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
        'efi': host.exists('/sys/firmware/efi'),
    }
