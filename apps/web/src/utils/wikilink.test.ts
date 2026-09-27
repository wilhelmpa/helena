import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseWikilink,
  scanWikilink,
  WIKILINK_INPUT,
  wikilinkLabel,
  wikilinkMarkdown,
  wikilinkTask,
} from './wikilink';

describe('wikilinks', () => {
  it('splits target, heading and alias', () => {
    assert.deepEqual(parseWikilink('Folder/Note#Setup|The setup'), {
      target: 'Folder/Note',
      heading: 'Setup',
      alias: 'The setup',
    });
    assert.deepEqual(parseWikilink('Note'), { target: 'Note', heading: null, alias: null });
    assert.deepEqual(parseWikilink('Note\\|In a table'), {
      target: 'Note',
      heading: null,
      alias: 'In a table',
    });
  });

  it('labels a link by its alias, else target and heading', () => {
    assert.equal(wikilinkLabel('Folder/Note|Alias'), 'Alias');
    assert.equal(wikilinkLabel('Note#Setup'), 'Note › Setup');
    assert.equal(wikilinkLabel('Note'), 'Note');
  });

  it('tells a task identifier from a note name', () => {
    assert.equal(wikilinkTask('VOL-12'), 'VOL-12');
    assert.equal(wikilinkTask('VOL-12|the task'), 'VOL-12');
    assert.equal(wikilinkTask('2026-09-23'), null);
    assert.equal(wikilinkTask('vol-12'), null);
  });

  it('finds a link in a line and writes it back as it was', () => {
    const line = 'See [[Folder/Note|Alias]] and more';
    const found = scanWikilink(line, 4);
    assert.deepEqual(found, { inner: 'Folder/Note|Alias', end: 25 });
    assert.equal(wikilinkMarkdown(found!.inner), '[[Folder/Note|Alias]]');
    assert.equal(scanWikilink('[[a]b]]', 0), null);
    assert.equal(scanWikilink('[[ ]]', 0), null);
    assert.equal(scanWikilink('[[open', 0), null);
  });

  it('turns typed closing brackets into a link', () => {
    assert.equal(WIKILINK_INPUT.exec('text [[Release notes]]')?.[1], 'Release notes');
    assert.equal(WIKILINK_INPUT.exec('text [[Release notes]'), null);
  });
});
