#!/usr/bin/env python3
"""Bounded private Nextcloud access for known provisioned project workspaces."""
import base64
import json
import os
from pathlib import Path
import re
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

REGISTRY = Path(os.environ.get('WORKSPACE_REGISTRY', '/home/pw/services/volition-workspaces/.state/projects'))
SECRET = Path(os.environ.get('NEXTCLOUD_APP_PASSWORD_FILE', '/home/pw/services/volition-stack/.secrets/nextcloud_patrick_app_password'))
USER = os.environ.get('NEXTCLOUD_USER', 'owner@example.com')
ORIGIN = os.environ.get('NEXTCLOUD_INTERNAL_URL', 'http://127.0.0.1:8092')
PUBLIC = 'https://cloud.volition.one'
ALLOWED_TEXT = {'.md', '.txt', '.json', '.csv', '.yaml', '.yml'}
MAX_BYTES = 128 * 1024
MAX_PROJECTS = 200
MAX_SAFE_INTEGER = (1 << 53) - 1
DAV = '{DAV:}'
OC = '{http://owncloud.org/ns}'
PROJECT_KEY = re.compile(r'[A-Z][A-Z0-9]{0,31}')

class ValidationError(Exception): pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): return None

def relative_path(value, *, filename=False):
    if not isinstance(value, str) or len(value) > 1024 or any(ord(c)<32 for c in value) or any(c in value for c in ['\\','%','\x00']):
        raise ValidationError('Invalid relative path')
    if value.startswith('/') or any(p in ('.','..','') for p in value.split('/')) and value:
        raise ValidationError('Invalid relative path')
    if any(len(p)>255 for p in value.split('/')): raise ValidationError('Path component too long')
    if filename and ('/' in value or not value or Path(value).suffix.lower() not in ALLOWED_TEXT):
        raise ValidationError('Use a text filename without directories')
    return value

def registry():
    try:
        root_info = REGISTRY.lstat()
    except OSError as error:
        raise ValidationError('Invalid project registry') from error
    if (not stat.S_ISDIR(root_info.st_mode) or stat.S_ISLNK(root_info.st_mode)
            or root_info.st_uid != os.getuid() or root_info.st_mode & 0o022):
        raise ValidationError('Invalid project registry')
    result = []
    for file in sorted(REGISTRY.glob('*.json')):
        if len(result) >= MAX_PROJECTS:
            raise ValidationError('Project registry exceeds safe limit')
        try:
            info = file.lstat()
            if (not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode)
                    or info.st_size > 65536 or info.st_uid != os.getuid()
                    or info.st_mode & 0o022):
                raise ValidationError('Invalid project registry entry')
            item = json.loads(file.read_text(encoding='utf-8'))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise ValidationError('Invalid project registry entry') from error
        if not isinstance(item, dict):
            raise ValidationError('Invalid project registry entry')
        project = item.get('project', {})
        slug = item.get('slug','')
        if (item.get('schemaVersion') != 1 or not isinstance(project, dict)
                or not re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,63}', slug)
                or file.name != slug + '.json'):
            raise ValidationError('Invalid project registry entry')
        key = project.get('key')
        name = project.get('name', '')
        if (not isinstance(key, str) or PROJECT_KEY.fullmatch(key) is None
                or not isinstance(name, str) or len(name) > 200
                or type(project.get('id')) is not int or project['id'] < 1
                or type(project.get('teamId')) is not int or project['teamId'] < 1):
            raise ValidationError('Invalid project registry entry')
        files = item.get('resources',{}).get('files',{})
        if not isinstance(files, dict) or files.get('path') != '/Projects/'+slug:
            raise ValidationError('Invalid project registry entry')
        result.append({'projectKey': key, 'name': name, 'slug':slug, 'filesPath':files['path']})
    if len({item['projectKey'] for item in result}) != len(result):
        raise ValidationError('Project registry contains duplicate keys')
    return result

def project_for(key):
    if not isinstance(key,str) or PROJECT_KEY.fullmatch(key) is None: raise ValidationError('Invalid project key')
    matches=[p for p in registry() if p['projectKey']==key]
    if len(matches)!=1: raise ValidationError('Unknown provisioned project')
    return matches[0]

def request(parts, method='GET', data=None, headers=None, limit=MAX_BYTES):
    u=urllib.parse.urlsplit(ORIGIN)
    try:
        port = u.port
    except ValueError as error:
        raise ValidationError('Invalid internal origin') from error
    valid_endpoint = ((u.hostname == '127.0.0.1' and port == 8092)
                      or (u.hostname == 'nextcloud' and port in (None, 80)))
    if u.scheme!='http' or not valid_endpoint or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:
        raise ValidationError('Invalid internal origin')
    if (not isinstance(parts, list) or not parts
            or any(not isinstance(part, str) or not part or '/' in part
                   or relative_path(part) != part for part in parts)):
        raise ValidationError('Invalid internal path')
    info=SECRET.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid!=os.getuid(): raise ValidationError('Credential file is not private')
    value=SECRET.read_text().strip()
    if not value or len(value)>2048: raise ValidationError('Invalid credential')
    authorization=base64.b64encode((USER+':'+value).encode()).decode()
    path='/remote.php/dav/files/'+urllib.parse.quote(USER,safe='')+'/'+ '/'.join(urllib.parse.quote(p,safe='')for p in parts)
    if method not in {'GET', 'PUT', 'PROPFIND'}:
        raise ValidationError('Invalid internal method')
    req=urllib.request.Request(ORIGIN.rstrip('/')+path,method=method,data=data,headers={**(headers or {}),'Host':'cloud.volition.one','Authorization':'Basic '+authorization})
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req,timeout=20) as response:
            body=response.read(limit+1)
            if len(body)>limit: raise ValidationError('Response exceeds safe limit')
            return response.status,body,response.headers
    except urllib.error.HTTPError as error:
        raise ValidationError('Nextcloud request returned HTTP '+str(error.code)) from None

def propfind(project, relative='', depth='0'):
    parts=['Projects',project['slug']]+(relative.split('/')if relative else [])
    xml=b'<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getcontenttype/><d:getetag/><oc:fileid/></d:prop></d:propfind>'
    status,body,_=request(parts,'PROPFIND',xml,{'Depth':depth,'Content-Type':'application/xml'},1024*1024)
    if status!=207 or b'<!DOCTYPE' in body.upper() or b'<!ENTITY' in body.upper(): raise ValidationError('Invalid DAV response')
    root=ET.fromstring(body)
    prefix='/remote.php/dav/files/'+USER+'/Projects/'+project['slug']
    target=relative.rstrip('/')
    items=[]
    for row in root.findall(DAV+'response'):
        href_value=urllib.parse.urlsplit(row.findtext(DAV+'href',''))
        if href_value.scheme or href_value.netloc or href_value.query or href_value.fragment:
            raise ValidationError('Invalid DAV path')
        href=urllib.parse.unquote(href_value.path, errors='strict').rstrip('/')
        if href!=prefix and not href.startswith(prefix+'/'): raise ValidationError('DAV path is outside project')
        item_relative=href[len(prefix):].lstrip('/')
        if item_relative:
            relative_path(item_relative)
        if depth == '0' and item_relative != target:
            raise ValidationError('DAV response did not match the requested path')
        if depth == '1' and item_relative != target:
            child_prefix = target + '/' if target else ''
            child = item_relative[len(child_prefix):] if item_relative.startswith(child_prefix) else ''
            if not child or '/' in child:
                raise ValidationError('DAV response exceeded the requested depth')
        props=None
        for propstat in row.findall(DAV+'propstat'):
            if ' 200 ' in propstat.findtext(DAV+'status',''): props=propstat.find(DAV+'prop');break
        if props is None: continue
        fid=props.findtext(OC+'fileid','')
        if not fid.isdigit() or not 1 <= int(fid) <= MAX_SAFE_INTEGER: continue
        size=props.findtext(DAV+'getcontentlength','0')
        etag=props.findtext(DAV+'getetag')
        if etag is not None and len(etag) > 512: raise ValidationError('Invalid DAV metadata')
        name=item_relative.rsplit('/',1)[-1] if item_relative else project['slug']
        items.append({'path':item_relative,'name':name, 'directory':props.find(DAV+'resourcetype/'+DAV+'collection')is not None,'size':int(size)if size.isdigit()and int(size)<=MAX_SAFE_INTEGER else 0,'etag':etag, 'fileId':int(fid),'url':PUBLIC+'/f/'+fid})
    if depth == '0' and len(items) != 1:
        raise ValidationError('No unique file link')
    return items

def handle(operation, data):
    schemas={'projects_list':set(),'files_list':{'projectKey','path','maxResults'},'file_read_text':{'projectKey','path','maxChars'},'file_link':{'projectKey','path'},'file_create_text':{'projectKey','filename','content'}}
    if operation not in schemas or not isinstance(data,dict)or set(data)-schemas[operation]:raise ValidationError('Invalid operation')
    if operation=='projects_list':return {'projects':registry()}
    project=project_for(data.get('projectKey'))
    if operation=='file_create_text':
        filename=relative_path(data.get('filename'),filename=True)
        content=data.get('content')
        if not isinstance(content,str)or '\0' in content or len(content.encode())>64*1024:raise ValidationError('Invalid text content')
        path='Ergebnisse/'+filename
        status,_,_=request(['Projects',project['slug'],'Ergebnisse',filename],'PUT',content.encode(),{'If-None-Match':'*','Content-Type':'text/plain; charset=utf-8'})
        if status!=201: raise ValidationError('File was not newly created')
        verified_status,verified,_=request(['Projects',project['slug'],'Ergebnisse',filename])
        if verified_status!=200:raise ValidationError('Write verification failed')
        if verified!=content.encode():raise ValidationError('Write verification failed')
        meta=propfind(project,path)
        if len(meta)!=1:raise ValidationError('File link verification failed')
        return {'created':True,'projectKey':data['projectKey'],**meta[0]}
    path=relative_path(data.get('path',''))
    if operation=='file_read_text':
        if Path(path).suffix.lower()not in ALLOWED_TEXT:raise ValidationError('Use file_link for binary documents')
        maximum=data.get('maxChars',12000)
        if type(maximum)is not int or not 1<=maximum<=25000:raise ValidationError('Invalid text limit')
        status,body,_=request(['Projects',project['slug']]+path.split('/'))
        if status!=200:raise ValidationError('File read failed')
        try: content=body.decode('utf8')
        except UnicodeDecodeError as error: raise ValidationError('File is not valid UTF-8 text') from error
        return {'projectKey':data['projectKey'],'path':path,'content':content[:maximum],'truncated':len(content)>maximum,'untrustedContent':True}
    entries=propfind(project,path,'1'if operation=='files_list'else'0')
    if operation=='file_link':
        if len(entries)!=1:raise ValidationError('No unique file link')
        return {'projectKey':data['projectKey'],**entries[0]}
    maximum=data.get('maxResults',30)
    if type(maximum)is not int or not 1<=maximum<=100:raise ValidationError('Invalid list limit')
    entries=[x for x in entries if x['path'].rstrip('/')!=path.rstrip('/')]
    return {'projectKey':data['projectKey'],'entries':entries[:maximum],'truncated':len(entries)>maximum,'untrustedContent':True}

if __name__=='__main__':
    try:
        raw=sys.stdin.buffer.read(100000)
        if len(raw)>=100000:raise ValidationError('Request too large')
        payload=json.loads(raw)
        print(json.dumps(handle(payload.get('operation'),payload.get('input')),ensure_ascii=False))
    except Exception as error:
        message=str(error)if isinstance(error,ValidationError)else'Private workspace request failed'
        print(json.dumps({'error':message}));sys.exit(1)
