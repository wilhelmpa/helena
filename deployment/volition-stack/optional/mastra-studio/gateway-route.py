#!/usr/bin/env python3
"""Safely add or remove the Mastra Studio route in the Volition gateway."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any


DEFAULT_CONFIG = Path("/home/pw/services/volition-stack/config/gateway.json")
HOST = "plan.volition.one"
OWNED_ROUTE: dict[str, Any] = {
    "prefix": "/mastra",
    "target": "http://172.30.95.2:4111",
    "stripPrefix": False,
}


class GatewayRouteError(RuntimeError):
    """The requested mutation cannot be performed safely."""


class RouteConflictError(GatewayRouteError):
    """An existing route overlaps the route owned by this helper."""


class ConcurrentModificationError(GatewayRouteError):
    """The configuration changed after it was read."""


def _read_bytes(path: Path) -> bytes:
    return path.read_bytes()


def _canonical_prefix(prefix: str) -> str:
    if not prefix.startswith("/"):
        return prefix
    if prefix == "/":
        return prefix
    return prefix.rstrip("/")


def _overlaps_owned(prefix: str) -> bool:
    candidate = _canonical_prefix(prefix)
    owned = OWNED_ROUTE["prefix"]
    return (
        candidate == owned
        or candidate == "/"
        or candidate.startswith(f"{owned}/")
        or owned.startswith(f"{candidate}/")
    )


def _paths(config: dict[str, Any], *, create: bool) -> list[Any]:
    routes = config.get("routes")
    if not isinstance(routes, dict):
        raise GatewayRouteError("gateway config must contain an object at routes")
    host = routes.get(HOST)
    if not isinstance(host, dict):
        raise GatewayRouteError(f"gateway config must contain an existing object at routes[{HOST!r}]")
    paths = host.get("paths")
    if paths is None and create:
        paths = []
        host["paths"] = paths
    if paths is None:
        return []
    if not isinstance(paths, list):
        raise GatewayRouteError(f"routes[{HOST!r}].paths must be an array")
    return paths


def _classify(paths: list[Any]) -> tuple[list[int], list[tuple[int, Any]]]:
    owned: list[int] = []
    conflicts: list[tuple[int, Any]] = []
    for index, route in enumerate(paths):
        if not isinstance(route, dict):
            raise GatewayRouteError(f"routes[{HOST!r}].paths[{index}] must be an object")
        prefix = route.get("prefix")
        if not isinstance(prefix, str):
            raise GatewayRouteError(f"routes[{HOST!r}].paths[{index}].prefix must be a string")
        if route == OWNED_ROUTE:
            owned.append(index)
        elif _overlaps_owned(prefix):
            conflicts.append((index, route))
    return owned, conflicts


def _mutate(config: dict[str, Any], action: str) -> tuple[dict[str, Any], bool, str]:
    paths = _paths(config, create=action == "add")
    owned, conflicts = _classify(paths)
    if len(owned) > 1:
        raise RouteConflictError("refusing to manage duplicate owned /mastra routes")
    if conflicts:
        indexes = ", ".join(str(index) for index, _ in conflicts)
        raise RouteConflictError(f"conflicting exact or overlapping /mastra route at paths index {indexes}")

    if action == "add":
        if owned:
            return config, False, "already present"
        paths.append(dict(OWNED_ROUTE))
        return config, True, "added"
    if action == "remove":
        if not owned:
            return config, False, "already absent"
        del paths[owned[0]]
        return config, True, "removed"
    raise GatewayRouteError(f"unsupported action: {action}")


def _write_exclusive(path: Path, data: bytes, mode: int) -> bool:
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    except FileExistsError:
        return False
    try:
        with os.fdopen(fd, "wb", closefd=True) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        raise
    return True


def _atomic_replace(path: Path, data: bytes, mode: int) -> None:
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb", closefd=True) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def update_route(action: str, config_path: Path | str = DEFAULT_CONFIG) -> str:
    path = Path(config_path)
    try:
        initial_metadata = path.lstat()
    except FileNotFoundError as error:
        raise GatewayRouteError(f"gateway config does not exist: {path}") from error
    if not stat.S_ISREG(initial_metadata.st_mode):
        raise GatewayRouteError(f"gateway config must be a regular file, not a symlink or special file: {path}")

    state_dir = path.parent / ".state"
    state_dir.mkdir(mode=0o700, exist_ok=True)
    os.chmod(state_dir, 0o700)
    lock_path = state_dir / f"{path.name}.mastra-studio.lock"
    lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        os.fchmod(lock_fd, 0o600)
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        metadata = path.lstat()
        if not stat.S_ISREG(metadata.st_mode):
            raise GatewayRouteError(f"gateway config must remain a regular file: {path}")
        original = _read_bytes(path)
        try:
            decoded = json.loads(original)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise GatewayRouteError(f"gateway config is not valid UTF-8 JSON: {path}") from error
        if not isinstance(decoded, dict):
            raise GatewayRouteError("gateway config root must be an object")

        updated, changed, result = _mutate(decoded, action)
        if not changed:
            return result

        if _read_bytes(path) != original:
            raise ConcurrentModificationError("gateway config changed concurrently; no update was written")
        backup_path = state_dir / f"{path.name}.before-mastra-studio"
        backup_created = _write_exclusive(backup_path, original, 0o600)
        try:
            os.chmod(backup_path, 0o600)
        except FileNotFoundError as error:
            raise GatewayRouteError(f"failed to create original gateway backup: {backup_path}") from error

        replacement = (json.dumps(updated, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        if _read_bytes(path) != original:
            if backup_created:
                backup_path.unlink(missing_ok=True)
            raise ConcurrentModificationError("gateway config changed concurrently; no update was written")
        _atomic_replace(path, replacement, stat.S_IMODE(metadata.st_mode))
        return result
    finally:
        os.close(lock_fd)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("add", "remove"))
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    args = parser.parse_args(argv)
    try:
        result = update_route(args.action, args.config)
    except GatewayRouteError as error:
        print(f"gateway-route: {error}", file=sys.stderr)
        return 2
    print(f"gateway-route: {result}: {args.config}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
