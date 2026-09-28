import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const extension = path.join(here, 'code-theme');
const manifest = JSON.parse(readFileSync(path.join(extension, 'package.json'), 'utf8'));

test('both VS Code themes are valid and expose the Helena colors', () => {
  assert.deepEqual(manifest.contributes.themes.map((theme) => theme.label), ['Helena Dark', 'Helena Light']);
  assert.equal(manifest.contributes.configurationDefaults['workbench.preferredLightColorTheme'], 'Helena Light');
  assert.equal(manifest.contributes.configurationDefaults['workbench.iconTheme'], 'helena-minimal');
  const icons = JSON.parse(readFileSync(path.join(extension, 'icons/icons.json'), 'utf8'));
  for (const icon of Object.values(icons.iconDefinitions)) {
    assert.match(readFileSync(path.join(extension, 'icons', icon.iconPath), 'utf8'), /#8b8595/);
  }
  for (const theme of manifest.contributes.themes) {
    const colors = JSON.parse(readFileSync(path.join(extension, theme.path), 'utf8'));
    assert.equal(colors.name, theme.label);
    assert.equal(colors.colors['sideBar.border'], colors.colors['sideBar.background']);
    assert.equal(colors.colors['activityBar.border'], colors.colors['activityBar.background']);
    assert.equal(colors.colors['editor.selectionBackground'], theme.label === 'Helena Dark' ? '#26212d' : '#e7dbfa');
    assert.equal(Object.keys(colors.colors).filter((key) => key.startsWith('terminal.ansi')).length, 16);
  }
});

test('installer adds extension defaults without changing user settings', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'helena-code-theme-'));
  try {
    const user = path.join(root, 'user');
    const extensions = path.join(root, 'extensions');
    mkdirSync(user);
    const settings = path.join(user, '.local/share/code-server/User/settings.json');
    mkdirSync(path.dirname(settings), { recursive: true });
    const custom = '{\n  // personal theme\n  "workbench.colorTheme": "My Theme"\n}\n';
    writeFileSync(settings, custom);
    execFileSync(path.join(here, 'install-code-theme.sh'), [extensions], { env: { ...process.env, HOME: user } });
    assert.equal(readFileSync(settings, 'utf8'), custom);
    assert.equal(readFileSync(path.join(extensions, 'helena.helena-themes-1.0.0/theme-sync.js'), 'utf8'), readFileSync(path.join(extension, 'theme-sync.js'), 'utf8'));
    assert.deepEqual(JSON.parse(readFileSync(path.join(extensions, 'helena.helena-themes-1.0.0/package.json'), 'utf8')).contributes.configurationDefaults, manifest.contributes.configurationDefaults);
    execFileSync(path.join(here, 'install-code-theme.sh'), [extensions], { env: { ...process.env, HOME: user } });
    assert.equal(readFileSync(settings, 'utf8'), custom);
    writeFileSync(settings, '{\n  "editor.wordWrap": "on"\n}\n');
    execFileSync(path.join(here, 'install-code-theme.sh'), [extensions], { env: { ...process.env, HOME: user } });
    assert.equal(readFileSync(settings, 'utf8'), '{\n  "editor.wordWrap": "on"\n}\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('theme sync changes Helena themes live and keeps a custom user theme', async () => {
  const messages = [];
  let selected;
  let autoDetect = true;
  let customPreferred;
  const updates = [];
  let channel;
  class Channel {
    constructor() { channel = this; }
    postMessage(message) { messages.push(message); }
    close() {}
  }
  const exports = {};
  const configuration = {
    inspect: (key) => ({ globalValue: key === 'colorTheme' ? selected : customPreferred }),
    get: () => selected,
    update: async (_key, value, target) => { selected = value; updates.push([value, target]); },
  };
  const windowConfiguration = {
    get: () => autoDetect,
    update: async (_key, value, target) => { autoDetect = value; updates.push([value, target]); },
  };
  runInNewContext(readFileSync(path.join(extension, 'theme-sync.js'), 'utf8'), {
    exports,
    require: () => ({ workspace: { getConfiguration: (section) => section === 'window' ? windowConfiguration : configuration }, ConfigurationTarget: { Global: 1 } }),
    BroadcastChannel: Channel,
  });
  exports.activate();
  assert.equal(messages[0]?.type, 'ready');
  channel.onmessage({ data: { type: 'theme', mode: 'light' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, [[false, 1], ['Helena Light', 1]]);
  channel.onmessage({ data: { type: 'theme', mode: 'dark' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates[2], ['Helena Dark', 1]);
  selected = 'My Theme';
  channel.onmessage({ data: { type: 'theme', mode: 'light' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updates.length, 3);
  selected = 'Helena Dark';
  customPreferred = 'My Preferred Theme';
  channel.onmessage({ data: { type: 'theme', mode: 'light' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updates.length, 3);
});
