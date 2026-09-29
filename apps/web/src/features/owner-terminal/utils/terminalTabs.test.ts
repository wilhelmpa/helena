import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addableKinds, DEFAULT_TABS, normalizeTabs, visibleTabs } from './terminalTabs';

describe('owner terminal tabs', () => {
  it('opens Shell, Claude Code, Codex and Flash on a fresh browser', () => {
    assert.deepEqual(
      normalizeTabs(null).map((tab) => tab.kind),
      ['shell', 'claude', 'codex', 'local-flash'],
    );
  });

  it('drops the duplicate and retired kinds a browser remembered, keeping each once', () => {
    const tabs = normalizeTabs([
      { kind: 'shell', name: 'main' },
      { kind: 'claude', name: 'main' },
      { kind: 'codex', name: 'main' },
      { kind: 'helena-dev-claude', name: 'main' },
      { kind: 'helena-dev-codex', name: 'main' },
      { kind: 'shell', name: 'main-2' },
      { kind: 'local-qwen38', name: 'main' },
      { kind: 'claude', name: '../x' },
    ]);
    assert.deepEqual(tabs, [
      { kind: 'shell', name: 'main' },
      { kind: 'claude', name: 'main' },
      { kind: 'codex', name: 'main' },
    ]);
  });

  it('keeps the session name of the first tab of a kind so it reconnects', () => {
    assert.deepEqual(normalizeTabs([{ kind: 'codex', name: 'main-2' }]), [
      { kind: 'codex', name: 'main-2' },
    ]);
  });

  it('falls back to the defaults when nothing usable was stored', () => {
    assert.equal(normalizeTabs([{ kind: 'helena-dev-codex', name: 'main' }]), DEFAULT_TABS);
    assert.equal(normalizeTabs('broken'), DEFAULT_TABS);
  });

  it('shows Flash only while the local model is ready', () => {
    assert.deepEqual(
      visibleTabs(DEFAULT_TABS, new Set()).map((tab) => tab.kind),
      ['shell', 'claude', 'codex'],
    );
    assert.deepEqual(
      visibleTabs(DEFAULT_TABS, new Set(['local-flash'])).map((tab) => tab.kind),
      ['shell', 'claude', 'codex', 'local-flash'],
    );
  });

  it('offers only the terminals that are not open yet', () => {
    const open = [
      { kind: 'shell' as const, name: 'main' },
      { kind: 'codex' as const, name: 'main' },
    ];
    assert.deepEqual(addableKinds(open, new Set()), ['claude']);
    assert.deepEqual(addableKinds(open, new Set(['local-flash'])), ['claude', 'local-flash']);
    assert.deepEqual(addableKinds(DEFAULT_TABS, new Set(['local-flash'])), []);
  });
});
