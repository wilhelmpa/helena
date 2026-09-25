import assert from 'node:assert/strict';
import test from 'node:test';
import {loadConfig, publicOrigin, withPublicOrigin} from '../config.mjs';
import {validateEnvelope} from '../validation.mjs';
import {areaBlock, withAreaBlock, AREA_BEGIN} from '../areas.mjs';

const base = {
  PROVISIONING_TOKEN: 'x'.repeat(40),
  CODE_PUBLIC_URL: '/code/',
  TERMINAL_PUBLIC_URL: '/focus/terminal-project/',
  PROJECT_BROWSER_PUBLIC_URL: '/browser/',
};

test('service paths resolve against the origin a request names', () => {
  const config = loadConfig(base);
  assert.equal(config.codeUrl, '/code/');
  assert.equal(config.planUrl, '');
  const urls = withPublicOrigin(config, 'https://helena.example.com/');
  assert.equal(urls.planUrl, 'https://helena.example.com/');
  assert.equal(urls.codeUrl, 'https://helena.example.com/code/');
  assert.equal(urls.terminalUrl, 'https://helena.example.com/focus/terminal-project/');
  assert.equal(urls.projectBrowserPublicUrl, 'https://helena.example.com/browser/');
  // Without an origin a path stays unresolved (no link), and a full URL stays as it is.
  assert.equal(withPublicOrigin(config, '').codeUrl, '');
  const legacy = loadConfig({...base, PLAN_PUBLIC_URL: 'http://old.local/', CODE_PUBLIC_URL: 'https://code.example.com/'});
  assert.equal(withPublicOrigin(legacy, '').planUrl, 'http://old.local/');
  assert.equal(withPublicOrigin(legacy, 'https://helena.example.com/').planUrl, 'https://helena.example.com/');
  assert.equal(withPublicOrigin(legacy, 'https://helena.example.com/').codeUrl, 'https://code.example.com/');
});

test('a public origin is a bare http(s) origin', () => {
  assert.equal(publicOrigin('https://helena.example.com'), 'https://helena.example.com/');
  assert.equal(publicOrigin(''), '');
  for (const bad of ['https://helena.example.com/app', 'ftp://x/', 'https://u:p@x/', 'https://x/?a=1']) {
    assert.throws(() => publicOrigin(bad));
  }
  assert.throws(() => loadConfig({...base, CODE_PUBLIC_URL: '/../etc/'}));
});

test('the envelope carries the public origin', () => {
  const envelope = {
    eventId: '11111111-1111-4111-8111-111111111111',
    eventType: 'project.provision',
    project: {id: 1, key: 'QA', name: 'QA', teamId: 1},
    requestedResources: ['coordinator'],
    publicUrl: 'https://helena.example.com/',
    createdAt: new Date('2026-09-25T00:00:00Z').toISOString(),
  };
  const headers = {idempotencyKey: envelope.eventId, eventType: 'project.provision'};
  assert.equal(validateEnvelope(envelope, headers).publicUrl, 'https://helena.example.com/');
  const without = {...envelope}; delete without.publicUrl;
  assert.equal('publicUrl' in validateEnvelope(without, headers), false);
  assert.throws(() => validateEnvelope({...envelope, publicUrl: 'https://helena.example.com/x'}, headers), /publicUrl/);
});

test('an area’s AGENTS.md is renewed where it is Helena’s and left where it is not', () => {
  const block = areaBlock({key: 'VOL', name: 'volition.one'}, {name: 'Homepage', folder: 'homepage'});
  assert.ok(block.startsWith(AREA_BEGIN));
  assert.doesNotMatch(block, /Plan/);
  const legacy = "# Area: Homepage\n\nThis folder belongs to the area \"Homepage\" of the project \"volition.one\" (VOL) in Plan.\nAgent runs for the tasks of this area start here. Keep the files of this area's work in this folder.\nThe project-wide instructions and links are in ../AGENTS.md and ../PROJECT.json.\nThe project's vault folder (the Files page in Plan) has a folder homepage/ for this area as well.\n";
  assert.equal(withAreaBlock(legacy, block), `${block}\n`);
  assert.equal(withAreaBlock(`${block}\n`, block), null);
  assert.equal(withAreaBlock('', block), `${block}\n`);
  assert.equal(withAreaBlock(legacy + 'An agent added this.\n', block), null);
  const edited = `Notes first.\n${block.replace('Homepage', 'Old name')}\nNotes after.\n`;
  assert.equal(withAreaBlock(edited, block), `Notes first.\n${block}\nNotes after.\n`);
});
