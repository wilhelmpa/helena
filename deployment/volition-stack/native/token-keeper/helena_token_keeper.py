#!/usr/bin/env python3
"""helena-token-keeper: keeps the model logins Helena's agents share alive, outside the sandbox.

Decision and design: docs/helena-decisions/token-keeper.md.

    helena_token_keeper.py tick     refresh what is due, write the agents' views and the status
    helena_token_keeper.py views    write the views and the status only (no network)
    helena_token_keeper.py status   print the status as JSON (no secret in it)

It runs as the runner user under Hermes' own interpreter with HERMES_HOME set to the Hermes root
(helena-token-keeper.service, every ten minutes and before the runner starts). Every refresh goes
through Hermes' own credential pool: the same cross-process lock as every Hermes process
(`auth.lock` next to the root `auth.json`), the same in-lock re-read that adopts a pair a peer
rotated instead of spending its refresh token again, the same handling of a dead grant.

Why: refresh tokens of the Claude and ChatGPT logins are single-use. An isolated agent sees the
shared logins read-only; when it refreshed an expired access token, the provider rotated the
refresh token, the agent could not write the new one back, and the stored one was spent
(2026-09-24, every Claude model in Hermes failed). So:

  - the keeper refreshes every login well before its access token expires, preferably while no
    agent unit runs (a provider may retire the previous access token on refresh), and at the
    latest while the token still outlives the longest agent unit;
  - what an isolated agent gets is a *view* the keeper writes: the same stores with every refresh
    token removed. The launcher binds the views where Hermes and the Codex CLI look for their
    logins. An agent can use an access token; it can never spend a refresh token.

Nothing this program prints, logs or writes into the status holds a token: only providers,
labels, times and short, redacted reasons.
"""

from __future__ import annotations

import argparse
import base64
import datetime
import fcntl
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

STATUS_VERSION = 1
REPORTER = 'helena-token-keeper'
# The providers whose refresh tokens are single-use (Hermes' SINGLE_USE_REFRESH_POOL_PROVIDERS):
# the keeper refreshes their OAuth logins. Other OAuth rows are reported, not refreshed.
MANAGED_PROVIDERS = ('anthropic', 'openai-codex', 'xai-oauth')
# Keys that hold something a login can be renewed with. Removed from every view.
REFRESH_KEYS = frozenset({'refresh_token', 'refreshToken'})
DEFAULT_HERMES_HOME = '/var/lib/volition/hermes'
DEFAULT_STATE_DIR = '/var/lib/helena-token-keeper'
DEFAULT_LAUNCHER_CONFIG = '/usr/local/lib/volition-isolation/launcher.json'
DEFAULT_RUNNER_USER = 'volition-hermes'
DEFAULT_UNIT = 'helena-token-keeper.service'
DEFAULT_UNIT_PREFIX = 'volition-agent-'
# How long an agent unit may run at most (launcher.json limits.runtimeMaxSecLimit), when the
# launcher's configuration cannot be read.
DEFAULT_UNIT_MAX_SECONDS = 4 * 3600
HOUR = 3600

log = logging.getLogger('helena-token-keeper')


# ── Small helpers (no Hermes needed) ─────────────────────────────────────────────────────


def now_iso(when: Optional[float] = None) -> str:
    moment = datetime.datetime.fromtimestamp(time.time() if when is None else when, datetime.timezone.utc)
    return moment.isoformat(timespec='seconds').replace('+00:00', 'Z')


def fingerprint(secret: Any) -> Optional[str]:
    """A short, one-way name of a secret, to tell two stores hold the same one. Never printed."""
    if not isinstance(secret, str) or not secret.strip():
        return None
    return hashlib.sha256(secret.strip().encode()).hexdigest()[:16]


def jwt_claims(token: Any) -> dict:
    if not isinstance(token, str) or token.count('.') != 2:
        return {}
    payload = token.split('.')[1]
    payload += '=' * (-len(payload) % 4)
    try:
        claims = json.loads(base64.urlsafe_b64decode(payload.encode()).decode())
    except Exception:  # noqa: BLE001 - not a JWT
        return {}
    return claims if isinstance(claims, dict) else {}


def jwt_expiry(token: Any) -> Optional[float]:
    exp = jwt_claims(token).get('exp')
    return float(exp) if isinstance(exp, (int, float)) and not isinstance(exp, bool) else None


def strip_refresh_tokens(value: Any) -> Any:
    """The same store without anything a login can be renewed with."""
    if isinstance(value, dict):
        return {key: strip_refresh_tokens(item) for key, item in value.items() if key not in REFRESH_KEYS}
    if isinstance(value, list):
        return [strip_refresh_tokens(item) for item in value]
    return value


_SECRETISH = re.compile(r'(?:sk-[A-Za-z0-9_-]{6,}|eyJ[A-Za-z0-9_.-]{10,}|[A-Za-z0-9+/_=.-]{32,})')


def redact(text: Any, limit: int = 240) -> Optional[str]:
    """A reason fit for the status: anything long enough to be a token is cut out."""
    if text is None:
        return None
    cleaned = _SECRETISH.sub('…', ' '.join(str(text).split()))
    return cleaned[:limit] or None


def atomic_write(path: Path, content: bytes, mode: int) -> bool:
    """Writes `content` to `path` through a temporary file in the same folder, so a reader sees
    the old file or the new one, never half of one. True when the file changed."""
    try:
        if path.read_bytes() == content:
            if (path.stat().st_mode & 0o777) != mode:
                os.chmod(path, mode)
            return False
    except FileNotFoundError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=f'.{path.name}.', suffix='.tmp')
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    except BaseException:
        try:
            os.unlink(temp)
        except FileNotFoundError:
            pass
        raise
    try:
        dir_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except OSError:
        pass
    return True


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()


def read_json(path: Path) -> Optional[Any]:
    try:
        return json.loads(path.read_text(encoding='utf-8-sig'))
    except FileNotFoundError:
        return None


@contextmanager
def exclusive(path: Path, timeout: float):
    """This program's own lock: one tick at a time, whoever started it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'a+') as handle:
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError('another keeper run holds the lock')
                time.sleep(0.2)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


# ── Settings ─────────────────────────────────────────────────────────────────────────────


class Settings:
    """Where things are and when a login is due. The two thresholds:

    prefer_before  refresh a login whose access token expires within this time, at a moment no
                   agent unit runs (an agent unit keeps the view it started with, see views());
    force_before   refresh it within this time even while agent units run: every unit that starts
                   must get a token that outlives it (the launcher's longest unit, two ticks and
                   a margin).
    """

    def __init__(self, args: argparse.Namespace):
        self.hermes_home = Path(args.hermes_home or os.environ.get('HERMES_HOME') or DEFAULT_HERMES_HOME)
        self.codex_home = Path(args.codex_home) if args.codex_home else self.hermes_home / '.codex'
        self.state_dir = Path(args.state_dir)
        self.interval = int(args.interval)
        launcher = self._launcher(args.launcher_config)
        limits = launcher.get('limits') if isinstance(launcher.get('limits'), dict) else {}
        unit_max = limits.get('runtimeMaxSecLimit') or limits.get('runtimeMaxSec') or DEFAULT_UNIT_MAX_SECONDS
        self.unit_max = int(unit_max) if isinstance(unit_max, (int, float)) and unit_max > 0 else DEFAULT_UNIT_MAX_SECONDS
        self.unit_prefix = str(launcher.get('unitPrefix') or DEFAULT_UNIT_PREFIX)
        self.force_before = (
            int(args.force_before) if args.force_before is not None
            else self.unit_max + 2 * self.interval + 300
        )
        self.prefer_before = max(
            int(args.prefer_before) if args.prefer_before is not None else 6 * HOUR,
            self.force_before + HOUR,
        )
        self.quiet_wait = max(0, int(args.quiet_wait))
        self.quiet_poll = max(1, int(args.quiet_poll))
        # A login is refreshed at most this often by the keeper, however short its tokens live.
        self.min_gap = max(0, int(args.min_gap))
        # Providers whose logins are renewed in this run whatever their expiry (a proof, or
        # finding out early whether a login is still alive).
        self.renew = frozenset(args.renew or ())
        self.runner_user = args.runner_user
        self.unit = args.unit
        self.hermes_bin = args.hermes_bin or str(Path(sys.executable).with_name('hermes'))

    @staticmethod
    def _launcher(path: Optional[str]) -> dict:
        if not path:
            return {}
        try:
            value = read_json(Path(path))
        except (OSError, ValueError):
            return {}
        return value if isinstance(value, dict) else {}

    @property
    def root_auth(self) -> Path:
        return self.hermes_home / 'auth.json'

    @property
    def codex_auth(self) -> Path:
        return self.codex_home / 'auth.json'

    @property
    def view_dir(self) -> Path:
        return self.state_dir / 'view'

    @property
    def hermes_view(self) -> Path:
        return self.view_dir / 'hermes' / 'auth.json'

    @property
    def codex_view(self) -> Path:
        return self.view_dir / 'codex' / 'auth.json'

    @property
    def status_file(self) -> Path:
        return self.state_dir / 'status' / 'hermes.json'

    @property
    def private_dir(self) -> Path:
        return self.state_dir / 'state'

    def relogin_command(self, provider: str) -> str:
        """The owner's commands in the owner terminal: sign Hermes' root store in again, then run
        the keeper at once so the agents get the new login without waiting for the timer."""
        subcommand = f'auth add {provider} --type oauth'
        try:
            from agent.turn_failure_copy import oauth_relogin_command

            hint = oauth_relogin_command(provider).split()
            if hint[:1] == ['hermes'] and all(re.fullmatch(r'[A-Za-z0-9._:/=-]+', part) for part in hint[1:]):
                subcommand = ' '.join(hint[1:])
        except Exception:  # noqa: BLE001 - Hermes' wording is a nicety
            pass
        home = str(self.hermes_home)
        return (
            f'sudo -u {self.runner_user} env HOME={home} HERMES_HOME={home} {self.hermes_bin} {subcommand}'
            f' && sudo systemctl start {self.unit}'
        )


# ── State the keeper keeps for itself (private, never printed) ─────────────────────────────


class State:
    def __init__(self, path: Path):
        self.path = path
        try:
            value = read_json(path)
        except (OSError, ValueError):
            value = None
        value = value if isinstance(value, dict) and value.get('version') == 1 else {}
        self.entries: dict[str, dict] = value.get('entries') if isinstance(value.get('entries'), dict) else {}
        self.codex: dict = value.get('codexCli') if isinstance(value.get('codexCli'), dict) else {}

    def entry(self, key: str) -> dict:
        return self.entries.setdefault(key, {})

    def prune(self, keep: Iterable[str]) -> None:
        keep = set(keep)
        for key in [key for key in self.entries if key not in keep]:
            del self.entries[key]

    def save(self) -> None:
        atomic_write(self.path, json_bytes({'version': 1, 'entries': self.entries, 'codexCli': self.codex}), 0o600)


# ── Agent units ───────────────────────────────────────────────────────────────────────────


def running_agent_units(prefix: str, runner: Callable[..., Any] = subprocess.run) -> Optional[int]:
    """How many agent units run now; None when systemd cannot be asked (then nobody waits)."""
    if not shutil.which('systemctl'):
        return None
    try:
        result = runner(
            ['systemctl', 'list-units', '--type=service', '--state=active,activating,deactivating,reloading',
             '--no-legend', '--plain', f'{prefix}*'],
            capture_output=True, text=True, timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return sum(1 for line in result.stdout.splitlines() if line.strip().startswith(prefix))


# ── Hermes ────────────────────────────────────────────────────────────────────────────────


class Hermes:
    """The few parts of Hermes the keeper uses, looked up once. Hermes owns the store format,
    the locks and the refresh; the keeper decides when."""

    def __init__(self):
        import agent.credential_pool as pool_module
        import hermes_cli.auth as auth

        self.pool_module = pool_module
        self.auth = auth
        self.load_pool = pool_module.load_pool
        self.STATUS_DEAD = pool_module.STATUS_DEAD
        self.STATUS_EXHAUSTED = pool_module.STATUS_EXHAUSTED
        self.AUTH_TYPE_OAUTH = pool_module.AUTH_TYPE_OAUTH
        self.managed = MANAGED_PROVIDERS

    def lock_timeout(self) -> float:
        base = float(getattr(self.auth, 'AUTH_LOCK_TIMEOUT_SECONDS', 15.0))
        return max(base, 25.0)

    @contextmanager
    def store_lock(self):
        with self.auth._auth_store_lock(timeout_seconds=self.lock_timeout()):
            yield

    def load_store(self, path: Path) -> dict:
        return self.auth._load_auth_store(path)

    def providers(self, store: dict, hermes_home: Path) -> list[str]:
        """The providers with a login in the root store, managed ones first."""
        found = set()
        pool = store.get('credential_pool')
        if isinstance(pool, dict):
            found |= {name for name, rows in pool.items() if isinstance(rows, list) and rows}
        providers = store.get('providers')
        if isinstance(providers, dict):
            for name, block in providers.items():
                tokens = block.get('tokens') if isinstance(block, dict) else None
                if isinstance(tokens, dict) and tokens.get('access_token'):
                    found.add(name)
        if (hermes_home / '.anthropic_oauth.json').exists():
            found.add('anthropic')
        return sorted(found, key=lambda name: (name not in self.managed, name))

    def expiry(self, provider: str, entry: Any) -> Optional[float]:
        if provider == 'anthropic':
            value = getattr(entry, 'expires_at_ms', None)
            return float(value) / 1000.0 if isinstance(value, (int, float)) and value > 0 else None
        if provider in ('openai-codex', 'xai-oauth'):
            return jwt_expiry(getattr(entry, 'access_token', None))
        return None

    def refresh(self, pool: Any, entry: Any) -> Any:
        """Hermes' own refresh of one pool row: under the shared lock it re-reads the row's store,
        adopts a pair a peer already rotated, else spends the refresh token once and writes the
        new pair back (and to the provider's singleton). `force=False` keeps Hermes from spending
        it again when a peer has just rotated it."""
        method = getattr(pool, '_refresh_entry', None)
        if callable(method):
            return method(entry, force=False)
        return pool.try_refresh_matching(credential_id=entry.id)


class ReasonCatcher(logging.Handler):
    """Hermes logs why a refresh failed and hands back only None; this keeps the last reason."""

    def __init__(self):
        super().__init__(level=logging.DEBUG)
        self.reasons: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001
            return
        lowered = message.lower()
        if 'refresh' in lowered and ('fail' in lowered or 'invalid' in lowered or 'error' in lowered):
            self.reasons.append(message)


@contextmanager
def catching_reasons():
    catcher = ReasonCatcher()
    loggers = [logging.getLogger(name) for name in ('agent.credential_pool', 'hermes_cli.auth', 'agent.anthropic_credentials')]
    saved = [(logger, logger.level) for logger in loggers]
    for logger in loggers:
        logger.addHandler(catcher)
        if logger.getEffectiveLevel() > logging.DEBUG:
            logger.setLevel(logging.DEBUG)
    try:
        yield catcher
    finally:
        for logger, level in saved:
            logger.removeHandler(catcher)
            logger.setLevel(level)


# ── The keeper ────────────────────────────────────────────────────────────────────────────


class Keeper:
    def __init__(self, settings: Settings, hermes: Hermes, *, clock: Callable[[], float] = time.time,
                 units: Optional[Callable[[], Optional[int]]] = None, sleep: Callable[[float], None] = time.sleep):
        self.settings = settings
        self.hermes = hermes
        self.clock = clock
        self.sleep = sleep
        self.units = units or (lambda: running_agent_units(settings.unit_prefix))
        self.state = State(settings.private_dir / 'state.json')
        self.logins: list[dict] = []
        self.errors: list[str] = []
        self.refreshed: set[str] = set()

    # ── entries ──

    def key(self, provider: str, entry: Any) -> str:
        return f'{provider}:{entry.id}'

    def due(self, provider: str, entry: Any, now: float) -> Optional[str]:
        """'force', 'prefer' or None: whether and how urgently a row wants a refresh."""
        if provider not in self.hermes.managed:
            return None
        if getattr(entry, 'auth_type', None) != self.hermes.AUTH_TYPE_OAUTH or not getattr(entry, 'refresh_token', None):
            return None
        if getattr(entry, 'last_status', None) == self.hermes.STATUS_DEAD:
            return None
        if provider in self.settings.renew and self.key(provider, entry) not in self.refreshed:
            return 'prefer'
        expiry = self.hermes.expiry(provider, entry)
        if expiry is None:
            return None
        remaining = expiry - now
        if remaining >= self.settings.prefer_before:
            return None
        record = self.state.entry(self.key(provider, entry))
        refreshed_at = record.get('refreshedAt')
        if isinstance(refreshed_at, (int, float)) and now - refreshed_at < self.settings.min_gap and remaining > 0:
            # Tokens that live shorter than the thresholds: refreshed at most every min_gap.
            record['shortLived'] = True
            return None
        failures = int(record.get('failures') or 0)
        attempted = record.get('attemptAt')
        if failures and isinstance(attempted, (int, float)):
            backoff = self.settings.interval * min(2 ** (failures - 1), 12)
            if now - attempted < backoff - 5:
                return None
        return 'force' if remaining < self.settings.force_before else 'prefer'

    def scan(self, now: float) -> list[tuple[str, Any, str]]:
        """Every row that is due, with how urgently."""
        found = []
        try:
            store = self.hermes.load_store(self.settings.root_auth)
        except Exception as exc:  # noqa: BLE001
            self.errors.append(f'root store unreadable: {redact(exc)}')
            return found
        for provider in self.hermes.providers(store, self.settings.hermes_home):
            if provider not in self.hermes.managed:
                continue
            try:
                entries = self.hermes.load_pool(provider).entries()
            except Exception as exc:  # noqa: BLE001
                self.errors.append(f'{provider}: pool unreadable: {redact(exc)}')
                continue
            for entry in entries:
                urgency = self.due(provider, entry, now)
                if urgency:
                    found.append((provider, entry, urgency))
        return found

    def wait_for_quiet(self) -> bool:
        """True once no agent unit runs (or systemd cannot say), False when the wait ran out."""
        waited = 0
        while True:
            running = self.units()
            if not running:
                return True
            if waited >= self.settings.quiet_wait:
                log.info('%d agent unit(s) still running; the refresh waits for the next run', running)
                return False
            self.sleep(self.settings.quiet_poll)
            waited += self.settings.quiet_poll

    def refresh_due(self, due: list[tuple[str, Any, str]]) -> None:
        if not due:
            return
        forced = any(urgency == 'force' for _, _, urgency in due)
        quiet = forced or self.wait_for_quiet()
        spent: set[str] = set()
        for provider, stale, urgency in due:
            if urgency == 'prefer' and not quiet:
                continue
            # Re-read the row: a peer (or the refresh of an alias row just now) may have rotated it.
            pool = self.hermes.load_pool(provider)
            entry = next((item for item in pool.entries() if item.id == stale.id), None)
            if entry is None or self.due(provider, entry, self.clock()) is None:
                continue
            token_print = fingerprint(entry.refresh_token)
            if token_print in spent:
                # Two rows share one refresh token (an alias of the singleton): Hermes' sync of the
                # first carries the new pair; spending it twice would revoke the family.
                continue
            spent.add(token_print)
            after = self.refresh_one(provider, pool, entry)
            if after is not None:
                # An alias row Hermes has just synced to the new pair is not refreshed again.
                spent.add(fingerprint(getattr(after, 'refresh_token', None)))

    def refresh_one(self, provider: str, pool: Any, entry: Any) -> Any:
        """Refreshes one row; answers the row as it is now when the refresh worked."""
        key = self.key(provider, entry)
        record = self.state.entry(key)
        before_status = getattr(entry, 'last_status', None)
        record['attemptAt'] = self.clock()
        with catching_reasons() as reasons:
            try:
                result = self.hermes.refresh(pool, entry)
            except Exception as exc:  # noqa: BLE001 - Hermes normally returns None instead
                result = None
                reasons.reasons.append(str(exc))
        after = next((item for item in self.hermes.load_pool(provider).entries() if item.id == entry.id), None)
        reason = redact(reasons.reasons[-1]) if reasons.reasons else None
        if result is not None and after is not None and getattr(after, 'last_status', None) != self.hermes.STATUS_DEAD:
            record.update(refreshedAt=self.clock(), failures=0, error=None)
            record.pop('shortLived', None)
            self.refreshed.add(key)
            log.info('%s %s refreshed; the access token now expires %s', provider, entry.label or entry.id,
                     now_iso(self.hermes.expiry(provider, after)) if self.hermes.expiry(provider, after) else 'at an unknown time')
            return after
        record['failures'] = int(record.get('failures') or 0) + 1
        dead = after is None or getattr(after, 'last_status', None) == self.hermes.STATUS_DEAD
        if dead:
            error = redact(getattr(after, 'last_error_message', None)) if after is not None else None
            record['error'] = error or reason or 'the provider rejected the login'
            record['dead'] = True
            log.warning('%s %s: the login is no longer valid (%s); it has to be signed in again',
                        provider, entry.label or entry.id, record['error'])
            return None
        record['error'] = reason or 'the refresh failed'
        log.warning('%s %s: refresh failed (%s); retrying later', provider, entry.label or entry.id, record['error'])
        # Hermes benches a row whose refresh failed. The keeper refreshes hours early: while the
        # access token still works, a failed early refresh must not take the login out of use.
        expiry = self.hermes.expiry(provider, after)
        if (
            getattr(after, 'last_status', None) == self.hermes.STATUS_EXHAUSTED
            and before_status in (None, 'ok')
            and expiry is not None and expiry - self.clock() > 5 * 60
        ):
            try:
                pool_after = self.hermes.load_pool(provider)
                pool_after.reset_status(entry.id)
            except Exception as exc:  # noqa: BLE001
                log.debug('could not lift the bench on %s: %s', key, exc)
        return None

    # ── the Codex CLI's own login next to Hermes ──

    def reconcile_codex_cli(self) -> Optional[dict]:
        """The Codex CLI's login in the Hermes home (`.codex/auth.json`), which Hermes imports from
        and the catalog lists models with. When it holds the same refresh token as Hermes' own
        ChatGPT login, the two are one chain: the keeper keeps them equal (the newer pair wins),
        because either side spending a token the other still holds would get the whole family
        revoked. A login of its own is the Codex CLI's to refresh and is only reported."""
        path = self.settings.codex_auth
        try:
            data = read_json(path)
        except (OSError, ValueError) as exc:
            self.errors.append(f'Codex CLI login unreadable: {redact(exc)}')
            return None
        tokens = data.get('tokens') if isinstance(data, dict) else None
        if not isinstance(tokens, dict) or not tokens.get('access_token'):
            return None
        link = 'separate'
        cli_rt = tokens.get('refresh_token')
        try:
            with self.hermes.store_lock():
                store = self.hermes.load_store(self.settings.root_auth)
                block = (store.get('providers') or {}).get('openai-codex')
                hermes_tokens = block.get('tokens') if isinstance(block, dict) else None
                hermes_rt = hermes_tokens.get('refresh_token') if isinstance(hermes_tokens, dict) else None
                linked = self.state.codex.get('linkedFp')
                if hermes_rt and cli_rt and hermes_rt == cli_rt:
                    link = 'linked'
                elif hermes_rt and cli_rt and linked and linked == fingerprint(cli_rt):
                    # Hermes rotated the shared chain; the CLI still holds the spent token.
                    data['tokens'] = {**tokens, 'access_token': hermes_tokens.get('access_token'),
                                      'refresh_token': hermes_rt}
                    data['last_refresh'] = block.get('last_refresh') or now_iso(self.clock())
                    self.write_codex_cli(path, data)
                    log.info('Codex CLI login: took over the ChatGPT login Hermes rotated')
                    tokens, cli_rt, link = data['tokens'], hermes_rt, 'linked'
                elif hermes_rt and cli_rt and linked and linked == fingerprint(hermes_rt):
                    # The Codex CLI rotated the shared chain; Hermes must not spend its old token.
                    updated = {**hermes_tokens, 'access_token': tokens.get('access_token'), 'refresh_token': cli_rt}
                    if tokens.get('id_token'):
                        updated['id_token'] = tokens['id_token']
                    self.hermes.auth._save_codex_tokens(updated, data.get('last_refresh') or now_iso(self.clock()),
                                                        set_active=False)
                    log.info("Hermes' ChatGPT login: took over the pair the Codex CLI rotated")
                    link = 'linked'
                if link == 'linked':
                    self.state.codex['linkedFp'] = fingerprint(cli_rt)
        except Exception as exc:  # noqa: BLE001
            self.errors.append(f'Codex CLI login: {redact(exc)}')
        expiry = jwt_expiry(tokens.get('access_token'))
        return {'link': link, 'expiry': expiry}

    def write_codex_cli(self, path: Path, data: dict) -> None:
        mode = 0o600
        try:
            mode = path.stat().st_mode & 0o777
        except FileNotFoundError:
            pass
        atomic_write(path, json_bytes(data), mode)

    # ── views ──

    def write_views(self) -> dict:
        """What isolated agents see of the logins: the stores without their refresh tokens.

        The Hermes view is bound as a file onto the root `auth.json` of every Hermes unit; a unit
        keeps the file it started with (a bind pins the inode), which is why a refresh must leave
        every login valid for longer than the longest unit (force_before). The Codex view is a
        folder bound onto the profile's `.codex`, which follows every change."""
        result = {}
        try:
            try:
                with self.hermes.store_lock():
                    store = self.hermes.load_store(self.settings.root_auth)
            except TimeoutError:
                # Hermes replaces auth.json atomically: a read without the lock is still whole.
                store = self.hermes.load_store(self.settings.root_auth)
            view = strip_refresh_tokens(store if isinstance(store, dict) else {})
            changed = atomic_write(self.settings.hermes_view, json_bytes(view), 0o640)
            result['hermes'] = {'ok': True, 'changed': changed}
        except Exception as exc:  # noqa: BLE001 - the last good view stays
            self.errors.append(f'Hermes view not written: {redact(exc)}')
            result['hermes'] = {'ok': False, 'changed': False}
        try:
            data = read_json(self.settings.codex_auth)
            self.settings.codex_view.parent.mkdir(parents=True, exist_ok=True)
            if isinstance(data, dict):
                changed = atomic_write(self.settings.codex_view, json_bytes(strip_refresh_tokens(data)), 0o640)
            else:
                changed = self.settings.codex_view.exists()
                if changed:
                    self.settings.codex_view.unlink()
            result['codex'] = {'ok': True, 'changed': changed}
        except Exception as exc:  # noqa: BLE001
            self.errors.append(f'Codex view not written: {redact(exc)}')
            result['codex'] = {'ok': False, 'changed': False}
        return result

    # ── status ──

    def describe(self, codex: Optional[dict], now: float) -> list[dict]:
        logins = []
        try:
            store = self.hermes.load_store(self.settings.root_auth)
        except Exception:  # noqa: BLE001 - already reported
            store = {}
        seen_keys = []
        for provider in self.hermes.providers(store, self.settings.hermes_home):
            try:
                entries = self.hermes.load_pool(provider).entries()
            except Exception:  # noqa: BLE001 - reported by scan()
                continue
            for entry in entries:
                if getattr(entry, 'auth_type', None) != self.hermes.AUTH_TYPE_OAUTH:
                    continue
                key = self.key(provider, entry)
                seen_keys.append(key)
                logins.append(self.describe_entry(provider, entry, now))
        # A row Hermes removed after its grant died (Codex' singleton rows) is reported once more.
        for key, record in self.state.entries.items():
            if record.get('dead') and key not in seen_keys and now - float(record.get('attemptAt') or 0) < 7 * 24 * HOUR:
                provider, _, entry_id = key.partition(':')
                seen_keys.append(key)
                logins.append({
                    'store': 'hermes', 'provider': provider, 'id': entry_id, 'label': None, 'managed': True,
                    'state': 'invalid', 'expiresAt': None,
                    'refreshedAt': now_iso(record['refreshedAt']) if record.get('refreshedAt') else None,
                    'error': record.get('error'), 'command': self.settings.relogin_command(provider),
                })
        self.state.prune(seen_keys)
        # A rejected login the owner has signed in again beside it (a new row of the same
        # provider that works) is history, not a problem: Hermes prunes it after a day.
        live = {login['provider'] for login in logins if login['store'] == 'hermes' and login['state'] != 'invalid'}
        logins = [login for login in logins if not (login['state'] == 'invalid' and login['provider'] in live)]
        if codex is not None:
            expiry = codex.get('expiry')
            linked = codex.get('link') == 'linked'
            logins.append({
                'store': 'codex-cli', 'provider': 'openai-codex', 'id': 'codex-cli', 'label': 'Codex CLI',
                'managed': linked,
                'state': 'expired' if expiry is not None and expiry <= now else 'ok',
                'expiresAt': now_iso(expiry) if expiry else None, 'refreshedAt': None, 'error': None,
                'command': None,
                'note': 'linked' if linked else 'separate',
            })
        return logins

    def describe_entry(self, provider: str, entry: Any, now: float) -> dict:
        record = self.state.entries.get(self.key(provider, entry), {})
        expiry = self.hermes.expiry(provider, entry)
        managed = provider in self.hermes.managed and bool(getattr(entry, 'refresh_token', None))
        dead = getattr(entry, 'last_status', None) == self.hermes.STATUS_DEAD
        error = record.get('error')
        if dead:
            state = 'invalid'
            error = redact(getattr(entry, 'last_error_message', None)) or error or 'the provider rejected the login'
        elif expiry is not None and expiry <= now:
            state = 'expired'
        elif record.get('failures'):
            state = 'error'
        elif expiry is not None and managed and expiry - now < self.settings.prefer_before:
            state = 'expiring'
        else:
            state = 'ok'
            error = None
        refreshed = record.get('refreshedAt')
        # A token that lives shorter than the longest agent unit: renewed every min_gap, and a
        # long run can still outlive it.
        note = 'short-lived' if record.get('shortLived') and state != 'invalid' else None
        return {
            'store': 'hermes',
            'provider': provider,
            'id': str(entry.id),
            'label': redact(entry.label, 80),
            'managed': managed,
            'state': state,
            'expiresAt': now_iso(expiry) if expiry else None,
            'refreshedAt': now_iso(refreshed) if isinstance(refreshed, (int, float)) else None,
            'error': error if state != 'ok' else None,
            'command': self.settings.relogin_command(provider) if state == 'invalid' else None,
            'note': note,
        }

    def status(self, codex: Optional[dict], views: dict) -> dict:
        now = self.clock()
        return {
            'version': STATUS_VERSION,
            'reporter': REPORTER,
            'checkedAt': now_iso(now),
            'intervalSeconds': self.settings.interval,
            'preferBeforeSeconds': self.settings.prefer_before,
            'forceBeforeSeconds': self.settings.force_before,
            'logins': self.describe(codex, now),
            'views': views,
            'errors': [redact(error, 300) for error in self.errors][:10],
        }

    def write_status(self, status: dict) -> None:
        atomic_write(self.settings.status_file, json_bytes(status), 0o640)

    # ── runs ──

    def tick(self, *, refresh: bool) -> dict:
        codex = self.reconcile_codex_cli()
        if refresh:
            self.refresh_due(self.scan(self.clock()))
            codex = self.reconcile_codex_cli()
        views = self.write_views()
        status = self.status(codex, views)
        self.write_status(status)
        self.state.save()
        return status


# ── Command line ──────────────────────────────────────────────────────────────────────────


def parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog='helena-token-keeper', description=__doc__.split('\n\n')[0])
    parser.add_argument('command', choices=['tick', 'views', 'status'])
    parser.add_argument('--hermes-home')
    parser.add_argument('--codex-home')
    parser.add_argument('--state-dir', default=os.environ.get('HELENA_TOKEN_KEEPER_DIR', DEFAULT_STATE_DIR))
    parser.add_argument('--launcher-config', default=DEFAULT_LAUNCHER_CONFIG)
    parser.add_argument('--interval', type=int, default=600, help='seconds between two runs of the timer')
    parser.add_argument('--prefer-before', type=int, help='seconds before expiry a refresh waits for a quiet moment')
    parser.add_argument('--force-before', type=int, help='seconds before expiry a refresh no longer waits')
    parser.add_argument('--quiet-wait', type=int, default=240, help='how long one run waits for no agent unit')
    parser.add_argument('--quiet-poll', type=int, default=15)
    parser.add_argument('--min-gap', type=int, default=1800, help='least seconds between two refreshes of a login')
    parser.add_argument('--renew', action='append', metavar='PROVIDER',
                        help='renew this provider\'s logins now (still waiting for a moment without agent units)')
    parser.add_argument('--runner-user', default=DEFAULT_RUNNER_USER)
    parser.add_argument('--unit', default=DEFAULT_UNIT)
    parser.add_argument('--hermes-bin')
    parser.add_argument('--verbose', action='store_true')
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse(sys.argv[1:] if argv is None else argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format='helena-token-keeper: %(message)s', stream=sys.stderr)
    # The journal gets the keeper's own lines and Hermes' warnings. Hermes' debug lines, which
    # the keeper reads while a refresh runs (ReasonCatcher), stay out of it.
    for handler in logging.getLogger().handlers:
        handler.setLevel(logging.DEBUG if args.verbose else logging.INFO)
    for name in ('agent', 'hermes_cli', 'httpx', 'urllib3'):
        logging.getLogger(name).setLevel(logging.WARNING)
    settings = Settings(args)
    if args.command == 'status':
        try:
            print(settings.status_file.read_text(encoding='utf-8'), end='')
        except FileNotFoundError:
            print(json.dumps({'version': STATUS_VERSION, 'reporter': REPORTER, 'logins': [],
                              'errors': ['the keeper has not run yet']}))
        return 0
    os.umask(0o027)
    try:
        hermes = Hermes()
    except Exception as exc:  # noqa: BLE001
        print(f'helena-token-keeper: Hermes cannot be loaded: {redact(exc)}', file=sys.stderr)
        return 2
    try:
        with exclusive(settings.private_dir / 'keeper.lock', timeout=settings.quiet_wait + 120):
            status = Keeper(settings, hermes).tick(refresh=args.command == 'tick')
    except TimeoutError as exc:
        print(f'helena-token-keeper: {exc}', file=sys.stderr)
        return 0
    problems = [login for login in status['logins'] if login['managed'] and login['state'] in ('invalid', 'expired', 'error')]
    for login in problems:
        print(f"helena-token-keeper: {login['provider']} {login.get('label') or login['id']}: {login['state']}"
              f"{' (' + login['error'] + ')' if login.get('error') else ''}", file=sys.stderr)
    # A dead login is the status' news, not a failure of the keeper: the unit only fails when
    # the keeper itself could not do its work (no view written).
    return 1 if any(not view.get('ok') for view in status['views'].values()) else 0


if __name__ == '__main__':
    raise SystemExit(main())
