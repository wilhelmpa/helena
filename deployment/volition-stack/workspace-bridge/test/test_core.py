import importlib.util
import pathlib
import tempfile
import json
import os
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('core',pathlib.Path(__file__).resolve().parents[1]/'core.py')
core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)

class WorkspaceTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.registry=pathlib.Path(self.tmp.name)
  entry=self.registry/'priv.json'
  entry.write_text(json.dumps({'schemaVersion':1,'project':{'id':3,'teamId':1,'key':'PRIV','name':'Private'},'slug':'priv','resources':{'files':{'path':'/Projects/priv'}}}))
  entry.chmod(0o600)
  self.patch=patch.object(core,'REGISTRY',self.registry);self.patch.start();self.addCleanup(self.patch.stop)
 def test_registry_restricts_unknown_projects(self):
  self.assertEqual(core.handle('projects_list',{})['projects'][0]['projectKey'],'PRIV')
  for key in ['MISSING','../priv','priv','PRIV/OTHER','A'*33]:
   with self.assertRaises(core.ValidationError):core.project_for(key)
  self.assertEqual(core.PROJECT_KEY.fullmatch('A1').group(),'A1')
  self.assertEqual(core.PROJECT_KEY.fullmatch('A').group(),'A')
  self.assertEqual(core.PROJECT_KEY.fullmatch('A'*32).group(),'A'*32)
 def test_registry_rejects_writable_or_mismatched_entries(self):
  entry=self.registry/'priv.json';entry.chmod(0o666)
  with self.assertRaises(core.ValidationError):core.registry()
  entry.chmod(0o600);entry.rename(self.registry/'other.json')
  with self.assertRaises(core.ValidationError):core.registry()
 def test_registry_rejects_writable_root_and_symlink(self):
  self.registry.chmod(0o777)
  try:
   with self.assertRaises(core.ValidationError):core.registry()
  finally:self.registry.chmod(0o700)
  entry=self.registry/'priv.json';entry.unlink();(self.registry/'target').write_text('{}')
  entry.symlink_to(self.registry/'target')
  with self.assertRaises(core.ValidationError):core.registry()
 def test_no_traversal_or_arbitrary_parameters(self):
  for path in ['../secret','a/../../b','/etc/passwd','a\\b','a%2fb','a//b','a/./b']:
   with self.assertRaises(core.ValidationError):core.relative_path(path)
  with self.assertRaises(core.ValidationError):core.handle('files_list',{'projectKey':'PRIV','url':'https://evil.test'})
  with self.assertRaises(core.ValidationError):core.handle('file_create_text',{'projectKey':'PRIV','filename':'x.env','content':'x'})
 def test_dav_exact_file_id_and_bounded_listing(self):
  xml=b'<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:response><d:href>/remote.php/dav/files/patrick.wilhelm%40volition.one/Projects/priv/Ergebnisse/test.md</d:href><d:propstat><d:prop><oc:fileid>42</oc:fileid><d:getcontentlength>12</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'
  with patch.object(core,'request',return_value=(207,xml,{})):
   result=core.handle('file_link',{'projectKey':'PRIV','path':'Ergebnisse/test.md'})
   self.assertEqual(result['url'],'https://cloud.volition.one/f/42')
  with patch.object(core,'request',return_value=(207,xml.replace(b'/Projects/priv/',b'/Projects/other/'),{})):
   with self.assertRaises(core.ValidationError):core.handle('file_link',{'projectKey':'PRIV','path':'Ergebnisse/test.md'})
  with patch.object(core,'request',return_value=(207,xml.replace(b'test.md',b'other.md'),{})):
   with self.assertRaises(core.ValidationError):core.handle('file_link',{'projectKey':'PRIV','path':'Ergebnisse/test.md'})
  nested=xml.replace(b'Ergebnisse/test.md',b'Ergebnisse/folder/nested.md')
  with patch.object(core,'request',return_value=(207,nested,{})):
   with self.assertRaises(core.ValidationError):core.handle('files_list',{'projectKey':'PRIV','path':'Ergebnisse'})
  entity=b'<!DOCTYPE x [<!ENTITY x "boom">]>'+xml
  with patch.object(core,'request',return_value=(207,entity,{})):
   with self.assertRaises(core.ValidationError):core.handle('file_link',{'projectKey':'PRIV','path':'Ergebnisse/test.md'})
 def test_text_read_is_bounded_and_binary_denied(self):
  with patch.object(core,'request',return_value=(200,b'hello world',{})):
   result=core.handle('file_read_text',{'projectKey':'PRIV','path':'Ergebnisse/a.md','maxChars':5})
   self.assertEqual(result['content'],'hello');self.assertTrue(result['truncated']);self.assertTrue(result['untrustedContent'])
  with self.assertRaises(core.ValidationError):core.handle('file_read_text',{'projectKey':'PRIV','path':'archive.pdf'})
  with patch.object(core,'request',return_value=(206,b'partial',{})):
   with self.assertRaises(core.ValidationError):core.handle('file_read_text',{'projectKey':'PRIV','path':'a.md'})
  with patch.object(core,'request',return_value=(200,b'\xff',{})):
   with self.assertRaises(core.ValidationError):core.handle('file_read_text',{'projectKey':'PRIV','path':'a.md'})
 def test_create_never_overwrites_and_verifies_content(self):
  calls=[]
  def request(parts,method='GET',data=None,headers=None,limit=None):
   calls.append((parts,method,data,headers))
   return (201,b'',{})if method=='PUT'else(200,b'result',{})
  with patch.object(core,'request',side_effect=request),patch.object(core,'propfind',return_value=[{'fileId':42,'url':'https://cloud.volition.one/f/42'}]):
   self.assertTrue(core.handle('file_create_text',{'projectKey':'PRIV','filename':'evidence.md','content':'result'})['created'])
  self.assertEqual(calls[0][0],['Projects','priv','Ergebnisse','evidence.md'])
  self.assertEqual(calls[0][3]['If-None-Match'],'*')
  with patch.object(core,'request',return_value=(204,b'',{})):
   with self.assertRaises(core.ValidationError):core.handle('file_create_text',{'projectKey':'PRIV','filename':'evidence.md','content':'result'})
 def test_private_credential_and_no_redirect(self):
  with patch.object(core,'ORIGIN','http://evil.test'):
   with self.assertRaises(core.ValidationError):core.request(['Projects','priv'])
  secret=self.registry/'password';secret.write_text('test-value');secret.chmod(0o644)
  with patch.object(core,'SECRET',secret):
   with self.assertRaises(core.ValidationError):core.request(['Projects','priv'])
  self.assertIsNone(core.NoRedirect().redirect_request(None,None,None,None,None,None))
 def test_internal_origin_and_proxy_are_strict(self):
  secret=self.registry/'password';secret.write_text('test-value');secret.chmod(0o600)
  for origin in ['http://127.0.0.1:80','http://nextcloud:8092','http://nextcloud.evil','http://127.0.0.1:8092/path']:
   with patch.object(core,'SECRET',secret),patch.object(core,'ORIGIN',origin):
    with self.assertRaises(core.ValidationError):core.request(['Projects','priv'])
  opener=unittest.mock.MagicMock();response=unittest.mock.MagicMock();response.__enter__.return_value=response;response.status=200;response.read.return_value=b'ok';response.headers={};opener.open.return_value=response
  with patch.object(core,'SECRET',secret),patch.object(core.urllib.request,'build_opener',return_value=opener) as build:
   core.request(['Projects','priv'],headers={'Host':'evil.test','Authorization':'Basic attacker'})
  self.assertIsInstance(build.call_args.args[0],core.urllib.request.ProxyHandler)
  self.assertEqual(build.call_args.args[0].proxies,{})
  sent=opener.open.call_args.args[0]
  self.assertEqual(sent.get_header('Host'),'cloud.volition.one')
  self.assertNotEqual(sent.get_header('Authorization'),'Basic attacker')
  response.read.return_value=b'123456'
  with patch.object(core,'SECRET',secret),patch.object(core.urllib.request,'build_opener',return_value=opener):
   with self.assertRaises(core.ValidationError):core.request(['Projects','priv'],limit=5)
  with patch.object(core,'SECRET',secret):
   with self.assertRaises(core.ValidationError):core.request(['Projects','priv'],method='DELETE')

if __name__=='__main__':unittest.main()
