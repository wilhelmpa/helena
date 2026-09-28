"""The thermal guard and the boot restore (helena-power-guard.service, root, always on).

At start, and whenever the EC driver appears (the module loads after boot, or is installed),
it applies the owner's last choice: the power profile and the fans. Then every two seconds it
reads the CPU temperature (the EC's sensor and k10temp's Tctl, the hotter one). While the
owner's fans are fixed below level 5 and the CPU stays at or above the limit (default 90 °C)
for a few seconds, it raises them to 5 and says so; when the CPU has stayed below the release
temperature for two minutes, it puts the owner's level back. The old setup ran the fans fixed
at level 1 and the CPU reached 99 °C and throttled (2026-01); this is the net under that.

Without the EC driver the guard has nothing to do: it reports "not available" and looks again
every 30 seconds, without an error loop."""

from __future__ import annotations

import os
import fcntl
import signal
import threading

from . import events, power
from .common import Host, HostError, atomic_write_json, iso
from .config import Config, load_settings, save_settings

TICK = 2.0
ABSENT_TICK = 30.0
# Without any temperature reading the guard cannot see heat; after this long it assumes the
# worst while the fans are fixed low.
BLIND_SECONDS = 30.0
RYZENADJ_RECHECK = 300.0
GPU_HOLD_SECONDS = 10.0
IDLE_RELEASE_SECONDS = 300.0


def build_slot_active(host: Host, marker_dir: str | None) -> bool:
    if not marker_dir:
        return False
    for name in ('test.1', 'test.2', 'server.1'):
        if not host.exists(f'{marker_dir}/{name}.owner'):
            continue
        try:
            with open(host.path(f'{marker_dir}/{name}.lock'), 'rb') as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    return True
                finally:
                    fcntl.flock(lock, fcntl.LOCK_UN)
        except OSError:
            continue
    return False


def profile_step(state: dict, *, now: float, gpu_busy: int | None, build_active: bool,
                 mode: str) -> tuple[dict, str]:
    state = dict(state)
    if mode != 'auto':
        state.update(highSince=None, lastDemandAt=None, profile=mode)
        return state, mode
    high = gpu_busy is not None and gpu_busy > 50
    if high:
        if state.get('highSince') is None:
            state['highSince'] = now
    else:
        state['highSince'] = None
    demand = build_active or (high and now - state['highSince'] > GPU_HOLD_SECONDS)
    if demand:
        state['lastDemandAt'] = now
    profile = state.get('profile') or 'balanced'
    if demand:
        profile = 'performance'
    elif profile == 'performance' and (state.get('lastDemandAt') is None or
                                        now - state['lastDemandAt'] >= IDLE_RELEASE_SECONDS):
        profile = 'balanced'
    state['profile'] = profile
    return state, profile


def guard_needed(fans: dict | None) -> bool:
    return bool(fans) and fans.get('mode') == 'fixed' and isinstance(fans.get('level'), int) and fans['level'] < 5


def guard_step(state: dict, *, temperature: float | None, now: float, fans: dict | None,
               limits: dict) -> tuple[dict, str | None]:
    """One look at the temperature. Returns the new state and what to do: 'engage' (fans to
    5), 'release' (the owner's level back) or None."""
    state = dict(state)
    limit = float(limits.get('limit', 90))
    hold = float(limits.get('holdSeconds', 5))
    release_below = float(limits.get('releaseBelow', 80))
    release_seconds = float(limits.get('releaseSeconds', 120))
    if not guard_needed(fans):
        # Auto or level 5: nothing to protect; a raise in effect ends (the owner's choice is
        # already the safer one, and was applied when it was made).
        if state.get('active'):
            state.update(active=False, releasedAt=now, overSince=None, underSince=None)
            return state, None
        state.update(overSince=None, underSince=None)
        return state, None
    if temperature is not None:
        state['lastTemperatureC'] = temperature
        state['blindSince'] = None
    elif state.get('blindSince') is None:
        state['blindSince'] = now
    hot = temperature is not None and temperature >= limit
    blind_since = state.get('blindSince')
    blind = temperature is None and blind_since is not None and now - blind_since >= BLIND_SECONDS
    if not state.get('active'):
        if hot or blind:
            since = state.get('overSince')
            if since is None:
                since = now
            state['overSince'] = since
            if blind or now - since >= hold:
                state.update(active=True, engagedAt=now, reason='blind' if blind else 'hot',
                             peakC=temperature, underSince=None)
                return state, 'engage'
        else:
            state['overSince'] = None
        return state, None
    if temperature is not None:
        state['peakC'] = max(state.get('peakC') or temperature, temperature)
    if temperature is not None and temperature <= release_below:
        since = state.get('underSince')
        if since is None:
            since = now
        state['underSince'] = since
        if now - since >= release_seconds:
            state.update(active=False, releasedAt=now, overSince=None, underSince=None)
            return state, 'release'
    else:
        state['underSince'] = None
    return state, None


def public_state(state: dict) -> dict:
    return {
        'active': bool(state.get('active')),
        'reason': state.get('reason') if state.get('active') else None,
        'engagedAt': iso(state.get('engagedAt')),
        'releasedAt': iso(state.get('releasedAt')),
        'peakC': state.get('peakC'),
        'lastTemperatureC': state.get('lastTemperatureC'),
        'available': bool(state.get('available')),
        'updatedAt': iso(state.get('updatedAt')),
        'profile': state.get('profile'),
        'thermalWarnSince': iso(state.get('thermalWarnSince')),
        'throttling': bool(state.get('throttling')),
    }


def restore(host: Host, config: Config, settings: dict, log) -> None:
    """Applies the owner's fan choice when the EC driver appears."""
    desired = settings.get('power') or {}
    fans = desired.get('fans')
    if isinstance(fans, dict) and fans.get('mode') in ('auto', 'fixed'):
        try:
            mode, level = power.validate_fans(fans.get('mode'), fans.get('level'))
            power.apply_fans(host, config.power, mode, level)
            log(f'restored the fans: {mode} {level or ""}'.strip())
        except HostError as error:
            log(f'could not restore the fans: {error.message}')


class Guard:
    def __init__(self, host: Host, config: Config, log):
        self.host = host
        self.config = config
        self.log = log
        self.state: dict = {'active': False, 'available': False}
        self.stop = threading.Event()
        self.last_ryzenadj_check = 0.0

    def update_profile(self, settings: dict) -> None:
        desired = settings.get('power') or {}
        marker_dir = self.config.power.get('heavyMarkerDir')
        build_active = build_slot_active(self.host, marker_dir)
        gpu_busy = self.host.read_int(self.config.power.get('gpuBusyPath'))
        previous = self.state.get('profile')
        next_state, profile = profile_step(self.state, now=self.host.now(), gpu_busy=gpu_busy,
                                           build_active=build_active, mode=desired.get('mode') or 'auto')
        if profile != previous:
            power.set_profile(self.host, self.config.power, profile, desired.get('tctlLimit', 90))
            self.log(f'power profile: {profile}')
            self.last_ryzenadj_check = self.host.now()
        self.state = next_state

    def write_state(self) -> None:
        self.state['updatedAt'] = self.host.now()
        os.makedirs(self.config.state_dir, mode=0o700, exist_ok=True)
        atomic_write_json(os.path.join(self.config.state_dir, 'guard.json'), public_state(self.state))

    def tick(self) -> float:
        host, config = self.host, self.config
        available = power.ec_available(host, config.power)
        settings = load_settings(config)
        if available and not self.state.get('available'):
            self.log('the EC driver is there; applying the last choice')
            self.state['available'] = True
            restore(host, config, settings, self.log)
            self.write_state()
        elif not available:
            if self.state.get('available') or 'updatedAt' not in self.state:
                self.log('the EC driver is not loaded; fan control not available')
                self.state.update(available=False, active=False)
                self.write_state()
            return ABSENT_TICK
        self.update_profile(settings)
        fans = (settings.get('power') or {}).get('fans')
        temperature = power.cpu_temperature(host, config.power)
        ec_temperature = host.read_int(f"{config.power.get('ecRoot')}/temp1/temp")
        tctl = next((sensor['celsius'] for sensor in power.read_temperatures(host)
                     if sensor['sensor'] == 'k10temp' and sensor.get('label') == 'Tctl'), None)
        if tctl is not None and tctl >= 95 and ec_temperature is not None and ec_temperature >= 95:
            if self.state.get('thermalWarnSince') is None:
                self.state['thermalWarnSince'] = host.now()
        else:
            self.state['thermalWarnSince'] = None
        throttle = host.read_int('/sys/devices/system/cpu/cpu0/thermal_throttle/package_throttle_count')
        previous_throttle = self.state.get('throttleCount')
        was_throttling = bool(self.state.get('throttling'))
        if throttle is not None and previous_throttle is not None and throttle > previous_throttle:
            self.state['throttleLastIncreaseAt'] = host.now()
        last_increase = self.state.get('throttleLastIncreaseAt')
        self.state['throttling'] = last_increase is not None and host.now() - last_increase < 300
        self.state['throttleCount'] = throttle
        before = bool(self.state.get('active'))
        self.state, action = guard_step(self.state, temperature=temperature, now=host.now(),
                                        fans=fans, limits=settings.get('guard') or {})
        if action == 'engage':
            power.apply_fans(host, config.power, 'fixed', 5)
            reason = self.state.get('reason')
            self.log(f'CPU at {temperature} °C with the fans fixed low: fans to 5 ({reason})')
            events.record(config.state_dir, source='guard', severity='warning', code='FansRaised',
                          message=f'{temperature} °C', at=host.now())
        elif action == 'release':
            mode, level = power.validate_fans(fans.get('mode'), fans.get('level'))
            power.apply_fans(host, config.power, mode, level)
            self.log(f'CPU cool again ({temperature} °C): fans back to {level}')
            events.record(config.state_dir, source='guard', severity='info', code='FansRestored',
                          message=f'{temperature} °C', at=host.now())
        if action or before != bool(self.state.get('active')) or was_throttling != bool(self.state.get('throttling')) or \
                host.now() - (self.state.get('updatedAt') or 0) > 60:
            self.write_state()
        self.recheck_ryzenadj(settings)
        return TICK

    def recheck_ryzenadj(self, settings: dict) -> None:
        """An EC mode change or a sleep resets ryzenadj's limits; a configured override is
        put back when the read-back no longer matches it."""
        now = self.host.now()
        if now - self.last_ryzenadj_check < RYZENADJ_RECHECK:
            return
        self.last_ryzenadj_check = now
        profile = self.state.get('profile') or 'balanced'
        if profile not in power.PROFILE_LAYERS:
            return
        try:
            override = power.validate_override(profile, (self.config.power.get('overrides') or {}).get(profile))
            if profile == 'performance':
                override = {**(override or {}), 'tctl': (settings.get('power') or {}).get('tctlLimit', 90)}
        except HostError:
            return
        if not override:
            return
        info = power.read_ryzenadj(self.host, self.config.power, fresh=True) or {}
        if not info.get('available'):
            return
        expected = {'stapm': 'stapmLimitW', 'fast': 'fastLimitW', 'slow': 'slowLimitW',
                    'tctl': 'tctlLimitC'}
        drift = any(key in override and info.get(field) is not None
                    and abs(info[field] * 1000 - override[key]) > 1000
                    for key, field in expected.items())
        if drift:
            try:
                power.apply_ryzenadj(self.host, self.config.power, override)
                self.log('ryzenadj limits were reset; applied them again')
            except HostError as error:
                self.log(f'could not apply the ryzenadj limits again: {error.message}')

    def run(self) -> int:
        signal.signal(signal.SIGTERM, lambda *_: self.stop.set())
        signal.signal(signal.SIGINT, lambda *_: self.stop.set())
        while not self.stop.is_set():
            try:
                wait = self.tick()
            except Exception as error:  # noqa: BLE001 - the guard must keep running
                self.log(f'guard tick failed: {type(error).__name__}: {error}')
                wait = TICK * 5
            self.stop.wait(wait)
        return 0


def initial_fans(config: Config, level: int = 5) -> None:
    """The installer's first choice (owner, 2026-09-24: all fans to maximum)."""
    settings = load_settings(config)
    settings.setdefault('power', {})['fans'] = {'mode': 'fixed', 'level': level}
    save_settings(config, settings)
