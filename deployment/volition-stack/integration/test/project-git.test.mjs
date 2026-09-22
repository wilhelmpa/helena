import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {ensureProjectGit} from '../project-git.mjs';
test('new project gets an independent local Git repository, safe ignores and idempotent preservation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'volition-git-'));
 try{
  const workspace={hostPath:root};
  assert.equal((await ensureProjectGit(workspace)).created,true);
  assert.equal(execFileSync('/usr/bin/git',['-C',root,'rev-parse','--show-toplevel'],{encoding:'utf8'}).trim(),root);
  assert.equal(execFileSync('/usr/bin/git',['-C',root,'config','--local','user.name'],{encoding:'utf8'}).trim(),'Volition Project Agent');
  assert.equal(execFileSync('/usr/bin/git',['-C',root,'config','--local','user.email'],{encoding:'utf8'}).trim(),'agent@volition.invalid');
  for(const file of ['.env','.env.production','.secrets/token','credentials/mail.json','.venv/bin/python','venv/pyvenv.cfg','pkg/__pycache__/mod.pyc','pkg/module.pyo','.pytest_cache/state']){
   assert.equal(execFileSync('/usr/bin/git',['-C',root,'check-ignore',file],{encoding:'utf8'}).trim(),file);
  }
  await fs.writeFile(path.join(root,'README.md'),'keep');
  execFileSync('/usr/bin/git',['-C',root,'add','README.md']);
  execFileSync('/usr/bin/git',['-C',root,'commit','-m','Initial project snapshot'],{
   env:{PATH:'/usr/bin:/bin',HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},
   stdio:'pipe',
  });
  assert.equal(execFileSync('/usr/bin/git',['-C',root,'log','-1','--format=%an|%ae'],{encoding:'utf8'}).trim(),'Volition Project Agent|agent@volition.invalid');
  execFileSync('/usr/bin/git',['-C',root,'config','--local','user.name','Existing Project Owner']);
  execFileSync('/usr/bin/git',['-C',root,'config','--local','user.email','existing@example.invalid']);
  execFileSync('/usr/bin/git',['-C',root,'remote','add','origin','https://example.invalid/owner/project.git']);
  assert.equal((await ensureProjectGit(workspace)).created,false);
  assert.equal(await fs.readFile(path.join(root,'README.md'),'utf8'),'keep');
  assert.equal(execFileSync('/usr/bin/git',['-C',root,'config','--local','user.name'],{encoding:'utf8'}).trim(),'Existing Project Owner');
  assert.equal(execFileSync('/usr/bin/git',['-C',root,'config','--local','user.email'],{encoding:'utf8'}).trim(),'existing@example.invalid');
  assert.equal(execFileSync('/usr/bin/git',['-C',root,'remote','get-url','origin'],{encoding:'utf8'}).trim(),'https://example.invalid/owner/project.git');
  await fs.rename(path.join(root,'.git'),path.join(root,'old-git'));
  await fs.symlink(path.join(root,'old-git'),path.join(root,'.git'));
  await assert.rejects(ensureProjectGit(workspace),/must not be a link/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
