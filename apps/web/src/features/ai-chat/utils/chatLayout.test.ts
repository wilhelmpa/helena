import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { artifactPlacement } from './chatLayout';

describe('chat layout by container width', () => {
  it('opens an artifact next to the conversation only when there is room for both', () => {
    assert.equal(artifactPlacement(900), 'overlay');
    assert.equal(artifactPlacement(1280), 'side');
  });

  it('names the container the workspace measures once, on its root', async () => {
    const { readFile } = await import('node:fs/promises');
    const workspace = await readFile(
      new URL('../components/workspace/ChatWorkspace.tsx', import.meta.url),
      'utf8',
    );
    assert.match(workspace, /@container\/chat/);
  });
});
