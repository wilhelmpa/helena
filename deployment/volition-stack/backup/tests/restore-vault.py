#!/usr/bin/env python3
"""Validate a Vaultwarden archive without starting a server or logging secrets."""
import argparse
import hashlib
import hmac
import json
from pathlib import Path
import re
import sqlite3
import tarfile
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('archive', type=Path)
parser.add_argument('manifest', type=Path)
args = parser.parse_args()

for path, label in ((args.archive, 'archive'), (args.manifest, 'manifest')):
    info = path.lstat()
    if not path.is_file() or path.is_symlink() or info.st_size < 1:
        raise ValueError(f'Vault {label} must be a non-empty regular file')
if args.manifest.stat().st_mode & 0o077:
    raise ValueError('Vault manifest permissions are too broad')

expected = json.loads(args.manifest.read_text(encoding='utf-8'))
required = {'schemaVersion', 'archiveSha256', 'ownerIdentifierHash', 'counts'}
if set(expected) != required or expected['schemaVersion'] != 1:
    raise ValueError('Vault manifest schema is invalid')
if not isinstance(expected['counts'], dict) or set(expected['counts']) != {'users', 'ciphers', 'invitations', 'attachments'}:
    raise ValueError('Vault manifest counters are invalid')
if any(type(value) is not int or value < 0 for value in expected['counts'].values()) or expected['counts']['users'] != 1:
    raise ValueError('Vault manifest counters are invalid')
if not isinstance(expected['ownerIdentifierHash'], str) or re.fullmatch(r'[0-9a-f]{64}', expected['ownerIdentifierHash']) is None:
    raise ValueError('Vault owner identifier hash is invalid')
if not isinstance(expected['archiveSha256'], str) or re.fullmatch(r'[0-9a-f]{64}', expected['archiveSha256']) is None:
    raise ValueError('Vault archive hash is invalid')
archive_digest = hashlib.sha256()
with args.archive.open('rb') as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b''):
        archive_digest.update(chunk)
archive_hash = archive_digest.hexdigest()
if not hmac.compare_digest(archive_hash, expected['archiveSha256']):
    raise ValueError('Vault archive hash differs from its manifest')

with tempfile.TemporaryDirectory(prefix='volition-vault-restore-') as temporary:
    root = Path(temporary)
    with tarfile.open(args.archive, 'r') as archive:
        for item in archive:
            path = Path(item.name)
            if path.is_absolute() or '..' in path.parts or path.parts[0] != 'vaultwarden':
                raise ValueError('Unexpected archive path')
            if not (item.isfile() or item.isdir()):
                raise ValueError('Links and special files are not accepted')
        archive.extractall(root, filter='data')
    db = root / 'vaultwarden/db.sqlite3'
    with sqlite3.connect(db) as connection:
        if connection.execute('pragma integrity_check').fetchall() != [('ok',)]:
            raise ValueError('Restored SQLite integrity failed')
        counts = {table: connection.execute(f'select count(*) from {table}').fetchone()[0]
                  for table in ('users', 'ciphers', 'invitations', 'attachments')}
        owner = connection.execute('select email from users').fetchone()
        if owner is None or not isinstance(owner[0], str):
            raise ValueError('Restored owner record missing')
        owner_hash = hashlib.sha256(owner[0].strip().lower().encode('utf-8')).hexdigest()
    if counts != expected['counts']:
        raise ValueError('Restored Vault counters differ from manifest')
    if not hmac.compare_digest(owner_hash, expected['ownerIdentifierHash']):
        raise ValueError('Restored owner identifier differs from manifest')
    print(json.dumps({'integrity': 'ok', 'manifestVerified': True,
                      'users': counts['users'], 'encryptedItems': counts['ciphers'],
                      'invitations': counts['invitations'], 'attachments': counts['attachments'],
                      'isolated': True, 'serverStarted': False}))
