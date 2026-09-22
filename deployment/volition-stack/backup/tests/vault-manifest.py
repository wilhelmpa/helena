#!/usr/bin/env python3
"""Write a private manifest for one quiescent Vaultwarden data archive."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile

TABLES = ('users', 'ciphers', 'invitations', 'attachments')


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_owner_hash(email: str) -> str:
    normalized = email.strip().lower()
    if not normalized or len(normalized) > 320 or any(ord(char) < 32 for char in normalized):
        raise ValueError('Vault owner identifier is invalid')
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()


def inspect_database(database: Path) -> tuple[str, dict[str, int]]:
    connection = sqlite3.connect(f'file:{database}?mode=ro', uri=True)
    try:
        connection.execute('pragma query_only = on')
        if connection.execute('pragma integrity_check').fetchall() != [('ok',)]:
            raise ValueError('Vault SQLite integrity failed before backup')
        counts = {table: connection.execute(f'select count(*) from {table}').fetchone()[0] for table in TABLES}
        if counts['users'] != 1:
            raise ValueError('Vault backup requires exactly one owner record')
        owner = connection.execute('select email from users').fetchone()
        if owner is None or not isinstance(owner[0], str):
            raise ValueError('Vault owner identifier is missing')
        return normalized_owner_hash(owner[0]), counts
    finally:
        connection.close()


def write_manifest(database: Path, archive: Path, output: Path) -> None:
    for path, label in ((database, 'database'), (archive, 'archive')):
        info = path.lstat()
        if not path.is_file() or path.is_symlink() or info.st_size < 1:
            raise ValueError(f'Vault {label} must be a non-empty regular file')
    owner_hash, counts = inspect_database(database)
    manifest = {
        'schemaVersion': 1,
        'archiveSha256': sha256_file(archive),
        'ownerIdentifierHash': owner_hash,
        'counts': counts,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f'.{output.name}.', suffix='.tmp', dir=output.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(manifest, handle, indent=2, sort_keys=True)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', required=True, type=Path)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    arguments = parser.parse_args()
    write_manifest(arguments.database, arguments.archive, arguments.output)
