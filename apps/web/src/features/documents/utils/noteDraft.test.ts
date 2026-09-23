import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  frontmatterToKeep,
  initialNoteDraft,
  isNoteDirty,
  noteDraftReducer,
  type NoteDraft,
  type NoteDraftAction,
} from './noteDraft';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function run(draft: NoteDraft, ...actions: NoteDraftAction[]) {
  return actions.reduce(noteDraftReducer, draft);
}

const opened = () =>
  run(initialNoteDraft(SHA_A, { body: '# Title\n', frontmatter: { tags: ['a'] } }), {
    type: 'ready',
    body: '# Title',
  });

describe('noteDraftReducer', () => {
  it('compares edits with what the editor serialized after loading, not the file', () => {
    const draft = opened();
    assert.equal(isNoteDirty(draft), false);
    assert.equal(isNoteDirty(run(draft, { type: 'edit', body: '# Title' })), false);
    assert.equal(isNoteDirty(run(draft, { type: 'edit', body: '# Title!' })), true);
    assert.equal(
      isNoteDirty(run(draft, { type: 'frontmatter', frontmatter: { tags: ['a', 'b'] } })),
      true,
    );
  });

  it('keeps edits typed while a save was out', () => {
    const draft = run(
      opened(),
      { type: 'edit', body: 'one' },
      { type: 'saving' },
      { type: 'edit', body: 'one two' },
      { type: 'saved', sha: SHA_B, snapshot: { body: 'one', frontmatter: { tags: ['a'] } } },
    );
    assert.equal(draft.sha, SHA_B);
    assert.equal(draft.status, 'saved');
    assert.equal(isNoteDirty(draft), true);
  });

  it('ignores its own sha coming back from a refetch', () => {
    const saved = run(
      opened(),
      { type: 'edit', body: 'one' },
      { type: 'saving' },
      { type: 'remote', sha: SHA_B, snapshot: { body: 'one', frontmatter: {} } },
    );
    assert.equal(saved.status, 'saving');
    const after = run(
      saved,
      { type: 'saved', sha: SHA_B, snapshot: { body: 'one', frontmatter: { tags: ['a'] } } },
      { type: 'remote', sha: SHA_A, snapshot: { body: 'old', frontmatter: {} } },
      { type: 'remote', sha: SHA_B, snapshot: { body: 'one', frontmatter: {} } },
    );
    assert.equal(after.status, 'saved');
    assert.equal(after.loaded.revision, 0);
  });

  it('reloads a change made elsewhere while nothing is unsaved', () => {
    const draft = run(opened(), {
      type: 'remote',
      sha: SHA_C,
      snapshot: { body: 'theirs', frontmatter: {} },
    });
    assert.equal(draft.sha, SHA_C);
    assert.equal(draft.loaded.body, 'theirs');
    assert.equal(draft.loaded.revision, 1);
    assert.equal(draft.saved, null);
  });

  it('stops at a conflict when a change made elsewhere meets unsaved edits', () => {
    const edited = run(opened(), { type: 'edit', body: 'mine' });
    const conflict = run(edited, {
      type: 'remote',
      sha: SHA_C,
      snapshot: { body: 'theirs', frontmatter: {} },
    });
    assert.equal(conflict.status, 'conflict');
    assert.equal(conflict.current.body, 'mine');
    assert.equal(
      run(edited, { type: 'saving' }, { type: 'failed', conflict: true }).status,
      'conflict',
    );
  });

  it('starts over from the version the conflict was resolved with', () => {
    const resolved = run(
      opened(),
      { type: 'edit', body: 'mine' },
      { type: 'failed', conflict: true },
      { type: 'load', sha: SHA_C, snapshot: { body: 'merged', frontmatter: {} } },
    );
    assert.equal(resolved.status, 'saved');
    assert.equal(resolved.loaded.body, 'merged');
    assert.equal(resolved.loaded.revision, 1);
    assert.ok(resolved.knownShas.includes(SHA_C));
  });

  it('lets an edit after a failed save try again', () => {
    const failed = run(opened(), { type: 'edit', body: 'x' }, { type: 'failed', conflict: false });
    assert.equal(failed.status, 'error');
    assert.equal(run(failed, { type: 'edit', body: 'xy' }).status, 'saved');
  });
});

describe('frontmatterToKeep', () => {
  it('keeps their properties unless I changed mine', () => {
    const draft = opened();
    assert.deepEqual(frontmatterToKeep(draft, { tags: ['theirs'] }), { tags: ['theirs'] });
    const changed = run(draft, { type: 'frontmatter', frontmatter: { tags: ['mine'] } });
    assert.deepEqual(frontmatterToKeep(changed, { tags: ['theirs'] }), { tags: ['mine'] });
  });
});
