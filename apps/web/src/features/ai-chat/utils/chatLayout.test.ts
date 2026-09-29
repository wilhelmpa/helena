import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { artifactPlacement, CHAT_SPLIT_WIDTH, chatLayoutMode } from './chatLayout';

describe('chat layout by container width', () => {
  it('shows the list as a column once the container is wide enough, else as a bar', () => {
    assert.equal(chatLayoutMode(380), 'compact');
    assert.equal(chatLayoutMode(CHAT_SPLIT_WIDTH - 1), 'compact');
    assert.equal(chatLayoutMode(CHAT_SPLIT_WIDTH), 'split');
    assert.equal(chatLayoutMode(1440), 'split');
  });

  it('opens an artifact next to the conversation only when there is room for both', () => {
    assert.equal(artifactPlacement(900), 'overlay');
    assert.equal(artifactPlacement(1280), 'side');
  });

  it('keeps the breakpoint equal to the container query the layout uses', async () => {
    const { readFile } = await import('node:fs/promises');
    // The named container is declared once, on the workspace root…
    const workspace = await readFile(
      new URL('../components/workspace/ChatWorkspace.tsx', import.meta.url),
      'utf8',
    );
    assert.match(workspace, /@container\/chat/);
    // …and the list column (ChatListPane, styled in the design system) is what actually
    // switches between a column and a drawer at it, so its container query has to match
    // CHAT_SPLIT_WIDTH: 48rem, 768px at the default root size.
    const css = await readFile(new URL('../../../design-system/overlays.css', import.meta.url), 'utf8');
    assert.equal(CHAT_SPLIT_WIDTH, 48 * 16);
    assert.match(css, /@container chat \(min-width: 48rem\) \{\s*\.ds-chat-list-column/);
  });
});
