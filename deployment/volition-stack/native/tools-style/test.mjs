import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

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
    assert.deepEqual(JSON.parse(readFileSync(path.join(extensions, 'helena.helena-themes-1.0.0/package.json'), 'utf8')).contributes.configurationDefaults, manifest.contributes.configurationDefaults);
    execFileSync(path.join(here, 'install-code-theme.sh'), [extensions], { env: { ...process.env, HOME: user } });
    assert.equal(readFileSync(settings, 'utf8'), custom);
    writeFileSync(settings, '{\n  "editor.wordWrap": "on"\n}\n');
    execFileSync(path.join(here, 'install-code-theme.sh'), [extensions], { env: { ...process.env, HOME: user } });
    assert.match(readFileSync(settings, 'utf8'), /"window.autoDetectColorScheme": true/);
    assert.match(readFileSync(settings, 'utf8'), /"editor.wordWrap": "on"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
