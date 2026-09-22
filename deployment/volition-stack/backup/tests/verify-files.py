import csv,hashlib,tarfile,sys
manifest='/home/pw/services/volition-stack/files/migration-manifest-2026-09-21.tsv'
with open(manifest) as f:
    expected={'./nextcloud-data/owner@example.com/files/'+r['nextcloud_path']:r['sha256'] for r in csv.DictReader(f,delimiter='\t')}
checked=[]
with tarfile.open(fileobj=sys.stdin.buffer,mode='r|') as archive:
    for member in archive:
        if member.name in expected:
            digest=hashlib.file_digest(archive.extractfile(member),'sha256').hexdigest()
            if digest!=expected[member.name]: raise ValueError('Restored file checksum mismatch')
            checked.append(member.name)
if set(checked)!=set(expected): raise ValueError(f'Missing restored files: {len(expected)-len(checked)}')
print(f'Encrypted restore: {len(checked)} migrated documents exactly match original SHA-256 checksums.')
