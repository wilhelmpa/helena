#!/usr/bin/env python3
"""Validate the quiescent Mastra Studio data archive without extracting it."""
from pathlib import Path, PurePosixPath
import sys
import tarfile


def validate_archive(path: Path) -> None:
    with tarfile.open(path, "r:") as handle:
        entries = [(member.name.removeprefix("./"), member) for member in handle.getmembers()]
    names = [name for name, _ in entries]
    studio = next((member for name, member in entries if name == "mastra-data/studio.db"), None)
    if not names or studio is None or not studio.isfile() or studio.size <= 0:
        raise ValueError("Mastra archive is empty or lacks a non-empty studio.db")
    if any(
        name.startswith("/")
        or ".." in PurePosixPath(name).parts
        or not (name == "mastra-data" or name.startswith("mastra-data/"))
        for name in names
    ):
        raise ValueError("Mastra archive contains an unsafe path")
    if any(not (member.isdir() or member.isfile()) for _, member in entries):
        raise ValueError("Mastra archive contains an unsupported entry type")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify-mastra-archive.py ARCHIVE")
    try:
        validate_archive(Path(sys.argv[1]))
    except (OSError, tarfile.TarError, ValueError) as error:
        raise SystemExit(str(error)) from error


if __name__ == "__main__":
    main()
