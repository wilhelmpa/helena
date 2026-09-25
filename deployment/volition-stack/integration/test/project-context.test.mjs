import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {BEGIN, END, OLD_MARKER, contextBlock, withContextBlock, writeProjectContext} from '../project-context.mjs';

const project = {id: 9, key: 'QA', name: 'QA project'};

test('project context keeps exact scoped links, renews its block, preserves instructions, and refuses symlinks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'helena-context-'));
  try {
    const coordinator = {id: 'qa-coordinator', workspace: path.join(root, 'agent')};
    await fs.mkdir(coordinator.workspace);
    const agents = path.join(coordinator.workspace, 'AGENTS.md');
    await fs.writeFile(agents, 'Existing instructions stay.\n');
    const args = [{planUrl: 'https://helena.example.com/', codeUrl: 'https://helena.example.com/code/'}, {project}, coordinator, {slug: 'qa', containerPath: '/projects/qa'}, 'Trusted owner-managed organization instructions'];
    await writeProjectContext(...args);
    const first = await fs.readFile(agents, 'utf8');
    await writeProjectContext(...args);
    assert.equal(await fs.readFile(agents, 'utf8'), first);
    assert.ok(first.startsWith('Existing instructions stay.\n\n' + BEGIN));
    assert.ok(first.endsWith(END + '\n'));
    assert.doesNotMatch(first, /browser_exec|Plan|Nextcloud|Volition/);
    assert.match(first, /browser_navigate/);
    assert.match(first, /QA-<number>/);
    const context = JSON.parse(await fs.readFile(path.join(coordinator.workspace, 'PROJECT.json'), 'utf8'));
    assert.equal(context.links.helena, 'https://helena.example.com/project/QA');
    assert.equal(context.links.plan, 'https://helena.example.com/project/QA');
    assert.equal(context.organizationInstructions, 'Trusted owner-managed organization instructions');
    assert.equal(context.links.documents, 'https://helena.example.com/project/QA/docs');
    assert.equal(context.links.files, 'https://helena.example.com/project/QA/files');
    assert.equal(context.links.code, 'https://helena.example.com/code/?folder=%2Fprojects%2Fqa');
    assert.match(context.documentLinkRule, /Markdown file path/);

    // An outdated block is renewed; what the owner wrote after it stays.
    await fs.writeFile(agents, first.replace('## Helena project QA', '## Old heading') + 'User instructions stay.\n');
    await writeProjectContext(...args);
    const renewed = await fs.readFile(agents, 'utf8');
    assert.match(renewed, /## Helena project QA/);
    assert.doesNotMatch(renewed, /Old heading/);
    assert.match(renewed, /User instructions stay\.\n$/);

    const contextPath = path.join(coordinator.workspace, 'PROJECT.json');
    await fs.writeFile(contextPath, JSON.stringify({userFile: 'keep'}));
    await assert.rejects(() => writeProjectContext(...args), /unrelated PROJECT.json/);
    assert.deepEqual(JSON.parse(await fs.readFile(contextPath, 'utf8')), {userFile: 'keep'});
    await fs.writeFile(contextPath, JSON.stringify(context));
    await fs.unlink(agents);
    const outside = path.join(root, 'outside.md'); await fs.writeFile(outside, 'untouched'); await fs.symlink(outside, agents);
    await assert.rejects(() => writeProjectContext(...args));
    assert.equal(await fs.readFile(outside, 'utf8'), 'untouched');
  } finally { await fs.rm(root, {recursive: true, force: true}); }
});

test('the block before the markers is replaced where it is still Helena’s, and kept where someone rewrote it', () => {
  const block = contextBlock(project);
  const legacy = `Team notes.\n\n${OLD_MARKER}\nRead PROJECT.json before project work. It contains … For browser_exec on the configured project CDP browser, set session="project" so the tab remains visible in Plan. Existing tool, sandbox and external-action approval rules remain in force.\n\nMore notes.\n`;
  const migrated = withContextBlock(legacy, block);
  assert.equal(migrated, `Team notes.\n\n${block}\n\nMore notes.\n`);
  assert.equal(withContextBlock(migrated, block), null);

  const rewritten = `${OLD_MARKER}\nOur own rule for this workspace.\n`;
  assert.equal(withContextBlock(rewritten, block), `${block}\nOur own rule for this workspace.\n`);

  assert.equal(withContextBlock('', block), `${block}\n`);
});
