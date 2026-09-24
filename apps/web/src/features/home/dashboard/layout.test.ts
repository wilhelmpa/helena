import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMPTY_ARRANGEMENT,
  MAX_DISMISSED,
  arrange,
  columnsOf,
  moveTo,
  sectionBlocks,
  withDismissed,
  withVisibility,
} from './layout';

// Start as the reader arranged it (user_preference.home_dashboard): which widgets show, in
// which order, and how the sections pair up. A widget the reader never saw finds its place
// by its default order, so a new tile from a plugin does not land at the end of everything.

const widget = (id: string, hiddenByDefault = false) => ({ id, hiddenByDefault });
const ids = <T extends { widget: { id: string } }>(list: T[]) => list.map((e) => e.widget.id);

describe('arrange', () => {
  const defaults = [widget('waiting'), widget('agents'), widget('tasks'), widget('ai', true)];

  it('keeps the default order and visibility while the reader changed nothing', () => {
    const arranged = arrange(defaults, EMPTY_ARRANGEMENT);
    assert.deepEqual(ids(arranged), ['waiting', 'agents', 'tasks', 'ai']);
    assert.deepEqual(
      arranged.map((e) => e.visible),
      [true, true, true, false],
    );
  });

  it('follows the reader’s order and puts a widget they never saw after its default neighbour', () => {
    const arranged = arrange(
      [widget('waiting'), widget('agents'), widget('new'), widget('tasks')],
      { ...EMPTY_ARRANGEMENT, order: ['tasks', 'waiting', 'agents'] },
    );
    assert.deepEqual(ids(arranged), ['tasks', 'waiting', 'agents', 'new']);
  });

  it('puts a new widget first when nothing comes before it by default', () => {
    const arranged = arrange([widget('first'), widget('b'), widget('a')], {
      ...EMPTY_ARRANGEMENT,
      order: ['a', 'b'],
    });
    assert.deepEqual(ids(arranged), ['first', 'a', 'b']);
  });

  it('ignores ids of widgets that are gone', () => {
    const arranged = arrange(defaults, { ...EMPTY_ARRANGEMENT, order: ['gone', 'agents'] });
    assert.deepEqual(ids(arranged), ['waiting', 'agents', 'tasks', 'ai']);
  });

  it('shows what the reader turned on and hides what they turned off', () => {
    const arranged = arrange(defaults, {
      ...EMPTY_ARRANGEMENT,
      hidden: ['agents'],
      shown: ['ai'],
    });
    assert.deepEqual(
      arranged.map((e) => [e.widget.id, e.visible]),
      [
        ['waiting', true],
        ['agents', false],
        ['tasks', true],
        ['ai', true],
      ],
    );
  });
});

describe('withVisibility', () => {
  it('stores only what differs from the default', () => {
    const off = withVisibility(EMPTY_ARRANGEMENT, widget('agents'), false);
    assert.deepEqual([off.hidden, off.shown], [['agents'], []]);
    const on = withVisibility(off, widget('agents'), true);
    assert.deepEqual([on.hidden, on.shown], [[], []]);
    const extra = withVisibility(EMPTY_ARRANGEMENT, widget('ai', true), true);
    assert.deepEqual([extra.hidden, extra.shown], [[], ['ai']]);
  });
});

describe('moveTo', () => {
  it('moves one id and leaves the rest in order', () => {
    assert.deepEqual(moveTo(['a', 'b', 'c', 'd'], 'd', 1), ['a', 'd', 'b', 'c']);
    assert.deepEqual(moveTo(['a', 'b', 'c'], 'a', 2), ['b', 'c', 'a']);
  });

  it('changes nothing for an unknown id or a place outside the list', () => {
    const list = ['a', 'b'];
    assert.equal(moveTo(list, 'x', 0), list);
    assert.equal(moveTo(list, 'a', 5), list);
  });
});

describe('withDismissed', () => {
  it('adds the key and keeps only failures still reported', () => {
    const next = withDismissed({ ...EMPTY_ARRANGEMENT, dismissed: ['run:1', 'chat:2'] }, 'run:3', [
      'run:1',
      'run:3',
    ]);
    assert.deepEqual(next.dismissed, ['run:1', 'run:3']);
  });

  it('never holds more than the preference allows', () => {
    const many = Array.from({ length: MAX_DISMISSED }, (_, i) => `run:${i}`);
    const next = withDismissed({ ...EMPTY_ARRANGEMENT, dismissed: many }, 'run:new', [
      ...many,
      'run:new',
    ]);
    assert.equal(next.dismissed.length, MAX_DISMISSED);
    assert.equal(next.dismissed.at(-1), 'run:new');
  });
});

describe('sectionBlocks', () => {
  it('pairs half-width sections and lets a full-width one stand alone', () => {
    const blocks = sectionBlocks([
      { id: 'needs', width: 'half' as const },
      { id: 'tasks', width: 'half' as const },
      { id: 'running', width: 'half' as const },
      { id: 'projects', width: 'full' as const },
      { id: 'notes', width: 'half' as const },
    ]);
    assert.deepEqual(
      blocks.map((block) =>
        block.kind === 'full' ? block.item.id : block.items.map((item) => item.id).join('+'),
      ),
      ['needs+tasks+running', 'projects', 'notes'],
    );
  });

  it('fills the two columns left, right, left … so reading order stays the reader’s', () => {
    assert.deepEqual(columnsOf(['a', 'b', 'c', 'd', 'e']), [
      ['a', 'c', 'e'],
      ['b', 'd'],
    ]);
  });
});
