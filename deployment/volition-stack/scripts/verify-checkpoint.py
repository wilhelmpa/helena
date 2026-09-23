#!/usr/bin/env python3
import argparse, hashlib, json, re, sys
from fnmatch import fnmatch
from pathlib import Path
SOURCE_DIRS=('backup','docs','gateway','google-bridge','integration','optional/mastra-studio','hermes/coder-sandbox','scripts','security-images','security-patches','workspace','workspace-bridge')
SOURCE_FILES=('compose.apps.yml','compose.gateway.yml','compose.hub.yml','compose.vault.yml','README.apps.md')
FILE_ALLOWLIST=('Dockerfile','init-sso.sh','nextcloud-entrypoint.sh','nextcloud-webdav.sh','remote-user.conf','remote-user.ini','remote-user.php')
EXCLUDED_PARTS={'node_modules','__pycache__','.state','.mastra'}
DENIED_PARTS={'.secrets','backups','garage','node_modules','__pycache__','.state','.mastra'}
DENIED_NAMES={'.env','runtime.env','gateway.json'}
PRIVATE_KEY=re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',re.I)
PRODUCTION_EMAIL=re.compile(r'[A-Za-z0-9._%+-]+@(?:volition\.one|emrani-wilhelm\.de|gmail\.com)',re.I)
GOOGLE_RESOURCE=re.compile(r'projects/(?=[a-z0-9-]*[0-9])[a-z][a-z0-9-]{5,}/subscriptions/[a-z0-9-]+',re.I)
def excluded(r):return bool(set(r.parts)&EXCLUDED_PARTS) or r.suffix=='.pyc' or any(fnmatch(r.name,p) for p in ('*.bak*','*.backup-*'))
def sanitize(data):
 try:text=data.decode()
 except UnicodeDecodeError:return data
 text=re.sub(r'[A-Za-z0-9._%+-]+@volition\.one','owner@example.com',text,flags=re.I)
 text=re.sub(r'[A-Za-z0-9._%+-]+@emrani-wilhelm\.de','archive@example.com',text,flags=re.I)
 text=re.sub(r'[A-Za-z0-9._%+-]+@gmail\.com','personal@example.com',text,flags=re.I)
 text=re.sub(r'^INBOX_BASELINES=.*$','INBOX_BASELINES={}',text,flags=re.M)
 text=re.sub(r'hermes-codex-[A-Za-z0-9_-]+/node_modules/@hermes/codex','hermes-codex-<project>/node_modules/@hermes/codex',text)
 return text.encode()
def expected_files(source):
 result={}
 for n in SOURCE_FILES:result[n]=sanitize((source/n).read_bytes())
 for d in SOURCE_DIRS:
  base=source/d
  for p in base.rglob('*'):
   if p.is_file() and not excluded(p.relative_to(base)):result[str(p.relative_to(source))]=sanitize(p.read_bytes())
 for n in FILE_ALLOWLIST:
  p=source/'files'/n;result[str(p.relative_to(source))]=sanitize(p.read_bytes())
 return result
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--source',default='/home/pw/services/volition-stack');ap.add_argument('--checkpoint',default=str(Path(__file__).resolve().parents[1]));a=ap.parse_args();source=Path(a.source).resolve();root=Path(a.checkpoint).resolve();expected=expected_files(source);errors=[]
 for rel,data in expected.items():
  t=root/rel
  if not t.is_file():errors.append(f'missing:{rel}')
  elif t.read_bytes()!=data:errors.append(f'drift:{rel}')
 for p in root.rglob('*'):
  if not p.is_file():continue
  rel=p.relative_to(root)
  if p.name in DENIED_NAMES or set(rel.parts)&DENIED_PARTS or p.suffix in {'.pem','.key','.sqlite','.db','.log','.pyc'}:errors.append(f'denied:{rel}');continue
  try:text=p.read_text()
  except UnicodeDecodeError:continue
  if PRIVATE_KEY.search(text) or PRODUCTION_EMAIL.search(text) or GOOGLE_RESOURCE.search(text):errors.append(f'sensitive:{rel}')
 cfg=json.loads((root/'config/gateway.example.json').read_text())
 if cfg.get('ownerEmail')!='owner@example.com' or cfg.get('issuer')!='https://team.cloudflareaccess.com':errors.append('gateway-template:identity')
 if any(r.get('audience')!=['<cloudflare-access-audience>'] for r in cfg.get('routes',{}).values()):errors.append('gateway-template:audience')
 if errors:print('\n'.join(sorted(set(errors))));return 1
 h=hashlib.sha256()
 for p in sorted(x for x in root.rglob('*') if x.is_file()):h.update(str(p.relative_to(root)).encode()+b'\0'+p.read_bytes())
 print(json.dumps({'sourceFiles':len(expected),'checkpointDigest':h.hexdigest(),'status':'ok'}));return 0
if __name__=='__main__':sys.exit(main())
