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
  const args=[{planUrl:'https://plan.example.com',codeUrl:'https://code.example.com'}, {project:{id:9,key:'QA',name:'QA project'}},coordinator,{slug:'qa',containerPath:'/projects/qa'},'Trusted owner-managed organization instructions'];
  await writeProjectContext(...args);
  const first=await fs.readFile(agents,'utf8');
  await writeProjectContext(...args);
  assert.equal(await fs.readFile(agents,'utf8'),first);
  assert.ok(first.startsWith('Existing instructions stay.'));
  const context=JSON.parse(await fs.readFile(path.join(coordinator.workspace,'PROJECT.json'),'utf8'));
  assert.equal(context.links.plan,'https://plan.example.com/project/QA');
  assert.equal(context.organizationInstructions,'Trusted owner-managed organization instructions');
  assert.equal(context.links.documents,'https://plan.example.com/project/QA/docs');
  assert.equal(context.links.files,'https://plan.example.com/project/QA/files');
  assert.match(first,/session="project"/);
  assert.doesNotMatch(first,/Nextcloud/);
  assert.match(context.documentLinkRule,/Markdown file path/);
  await fs.writeFile(agents, first.replace(/Use linked Plan documents and the project Files view[^\n]*?remain visible in Plan\./, "Use linked Plan documents and the project's private Nextcloud folder for durable results.") + '\nUser instructions stay.\n');
  await writeProjectContext(...args);
  const migrated = await fs.readFile(agents,'utf8');
  assert.match(migrated,/session="project"/);
  assert.match(migrated,/User instructions stay/);
  assert.doesNotMatch(migrated,/Nextcloud/);
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
