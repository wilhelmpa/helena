import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectFilesSlug } from './service';

test('maps project keys to their provisioned Nextcloud folder slug', () => {
  assert.equal(projectFilesSlug('KARR'), 'karr');
  assert.equal(projectFilesSlug('VERV'), 'verve');
});
