import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INTERNAL_READ_TOOLS,
  INTERNAL_WORKSPACE_TOOLS,
  KARR_CAREER_STATE_TOOLS,
  withInternalReadAccess,
  withInternalDataAccess,
  withKarrCareerStateAccess,
} from '../integration-tools.mjs';

test('internal data access is idempotent and preserves sandbox restrictions', () => {
  const before = { profile: 'coding', deny: ['group:messaging'], alsoAllow: ['itsaplan__get_issue'], sandbox: { tools: { alsoAllow: ['itsaplan__get_issue'], deny: ['exec'] } } };
  const after = withInternalReadAccess(before);
  assert.deepEqual(withInternalReadAccess(after), after);
  assert.deepEqual(after.deny, before.deny);
  assert.deepEqual(after.sandbox.tools.deny, before.sandbox.tools.deny);
  assert.deepEqual(before.alsoAllow, ['itsaplan__get_issue']);
  for (const name of INTERNAL_READ_TOOLS) {
    assert.ok(after.alsoAllow.includes(name));
    assert.ok(after.sandbox.tools.alsoAllow.includes(name));
  }
  assert.equal(INTERNAL_READ_TOOLS.some(name => /send|delete|secret|credential/.test(name)), false);
});

test('classifier and model-only restrictions cannot be silently widened', () => {
  assert.throws(() => withInternalReadAccess({ deny: ['*'] }), /tools-disabled/);
  assert.throws(() => withInternalReadAccess({ sandbox: { tools: { deny: ['*'] } } }), /tools-disabled/);
});

test('workspace access keeps model-only roles disabled and allows only bounded project functions', () => {
  assert.throws(() => withInternalDataAccess({ deny: ['*'] }), /tools-disabled/);
  const result = withInternalDataAccess({ deny: ['group:messaging'] });
  assert.deepEqual(result.deny, ['group:messaging']);
  assert.deepEqual(withInternalDataAccess(result), result);
  for (const name of INTERNAL_WORKSPACE_TOOLS) assert.ok(result.sandbox.tools.alsoAllow.includes(name));
  assert.equal(INTERNAL_WORKSPACE_TOOLS.some(name => /delete|overwrite|share|credential|exec/.test(name)), false);
});

test('KARR career state access grants only issue updates and preserves the comment-loop deny', () => {
  const before = {
    profile: 'coding',
    deny: ['group:messaging', 'itsaplan__add_comment'],
    sandbox: {
      tools: {
        alsoAllow: ['itsaplan__get_issue'],
        deny: ['group:messaging', 'itsaplan__add_comment'],
      },
    },
  };
  const after = withKarrCareerStateAccess(before);
  assert.deepEqual(withKarrCareerStateAccess(after), after);
  assert.deepEqual(KARR_CAREER_STATE_TOOLS, ['itsaplan__update_issue']);
  assert.ok(after.alsoAllow.includes('itsaplan__update_issue'));
  assert.ok(after.sandbox.tools.alsoAllow.includes('itsaplan__update_issue'));
  assert.ok(after.deny.includes('itsaplan__add_comment'));
  assert.ok(after.sandbox.tools.deny.includes('itsaplan__add_comment'));
  assert.throws(
    () => withKarrCareerStateAccess({ deny: ['itsaplan__update_issue'] }),
    /explicit deny/,
  );
  assert.throws(() => withKarrCareerStateAccess({ deny: ['*'] }), /tools-disabled/);
});
