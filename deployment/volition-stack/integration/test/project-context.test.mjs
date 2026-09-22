import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {writeProjectContext} from '../project-context.mjs';

test('project context keeps exact scoped links, preserves instructions, and refuses symlinks', async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'volition-context-'));
 try {
  const coordinator={id:'qa-coordinator',workspace:path.join(root,'agent')};
  await fs.mkdir(coordinator.workspace);
  const agents=path.join(coordinator.workspace,'AGENTS.md');
  await fs.writeFile(agents,'Existing instructions stay.\n');
  const args=[{planUrl:'https://plan.example.com',filesUrl:'https://files.example.com/apps/files',codeUrl:'https://code.example.com'}, {project:{id:9,key:'QA',name:'QA project'}},coordinator,{slug:'qa',containerPath:'/projects/qa'},'Trusted owner-managed organization instructions'];
  await writeProjectContext(...args);
  const first=await fs.readFile(agents,'utf8');
  await writeProjectContext(...args);
  assert.equal(await fs.readFile(agents,'utf8'),first);
  assert.ok(first.startsWith('Existing instructions stay.'));
  const context=JSON.parse(await fs.readFile(path.join(coordinator.workspace,'PROJECT.json'),'utf8'));
  assert.equal(context.links.plan,'https://plan.example.com/project/QA');
  assert.equal(context.organizationInstructions,'Trusted owner-managed organization instructions');
  assert.equal(context.links.documents,'https://plan.example.com/project/QA/docs');
  assert.equal(new URL(context.links.files).searchParams.get('dir'),'/Projects/qa');
  const contextPath=path.join(coordinator.workspace,'PROJECT.json');
  await fs.writeFile(contextPath,JSON.stringify({userFile:'keep'}));
  await assert.rejects(()=>writeProjectContext(...args),/unrelated PROJECT.json/);
  assert.deepEqual(JSON.parse(await fs.readFile(contextPath,'utf8')),{userFile:'keep'});
  await fs.writeFile(contextPath,JSON.stringify(context));
  await fs.unlink(agents);
  const outside=path.join(root,'outside.md');await fs.writeFile(outside,'untouched');await fs.symlink(outside,agents);
  await assert.rejects(()=>writeProjectContext(...args));
  assert.equal(await fs.readFile(outside,'utf8'),'untouched');
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
