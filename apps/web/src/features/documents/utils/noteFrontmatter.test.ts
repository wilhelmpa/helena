import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanTag, noteTags, noteType, withTags, withType } from './noteFrontmatter';

describe('note frontmatter', () => {
  it('reads tags from a list or a string, without "#"', () => {
    assert.deepEqual(noteTags({ tags: ['#release', 'ops', 3] }), ['release', 'ops']);
    assert.deepEqual(noteTags({ tags: 'release, ops' }), ['release', 'ops']);
    assert.deepEqual(noteTags({}), []);
    assert.equal(noteType({ type: 'meeting' }), 'meeting');
    assert.equal(noteType({ type: ['meeting'] }), '');
  });

  it('cleans a typed tag', () => {
    assert.equal(cleanTag(' #road map '), 'road-map');
    assert.equal(cleanTag(' # '), null);
  });

  it('changes tags and type and keeps every other property', () => {
    const frontmatter = { title: 'Release', tags: ['old'], aliases: ['R'] };
    assert.deepEqual(withTags(frontmatter, ['a', 'b']), {
      title: 'Release',
      tags: ['a', 'b'],
      aliases: ['R'],
    });
    assert.deepEqual(withType(frontmatter, ' guide '), {
      title: 'Release',
      tags: ['old'],
      aliases: ['R'],
      type: 'guide',
    });
  });

  it('removes a property that was emptied', () => {
    assert.deepEqual(withTags({ tags: ['a'], type: 'x' }, []), { type: 'x' });
    assert.deepEqual(withType({ tags: ['a'], type: 'x' }, '  '), { tags: ['a'] });
  });
});
