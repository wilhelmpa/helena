import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { hasTreeContent } from './treeContent';
import DocumentTreeRow from '@/features/documents/components/DocumentTreeRow';
import type { VaultTreeNode } from '@/features/documents/utils/vaultTree';

describe('sidebar chevrons', () => {
  it('requires a real child, including inside fragments', () => {
    assert.equal(hasTreeContent(null), false);
    assert.equal(
      hasTreeContent(
        <>
          {false}
          {null}
        </>,
      ),
      false,
    );
    assert.equal(hasTreeContent([]), false);
    assert.equal(
      hasTreeContent(
        <>
          <span>Unterpunkt</span>
        </>,
      ),
      true,
    );
  });

  it('omits the document chevron and expanded state for an empty folder', () => {
    const folder: VaultTreeNode = {
      item: { path: 'Home/Empty', name: 'Empty', title: 'Empty', kind: 'folder', updatedAt: null },
      children: [],
    };
    const props = {
      depth: 0,
      openPath: null,
      expanded: new Set<string>(),
      canEdit: false,
      onToggle: () => {},
      onNewNote: () => {},
      onAction: () => {},
    };
    const empty = renderToStaticMarkup(<DocumentTreeRow node={folder} {...props} />);
    const filled = renderToStaticMarkup(
      <DocumentTreeRow
        node={{
          ...folder,
          children: [{ ...folder, item: { ...folder.item, path: 'Home/Empty/Child' } }],
        }}
        {...props}
      />,
    );
    assert.doesNotMatch(empty, /lucide-chevron-right|aria-expanded/);
    assert.match(filled, /lucide-chevron-right/);
  });
});
