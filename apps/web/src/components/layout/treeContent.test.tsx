import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectGroup } from '@/components/helena/ProjectGroup';
import DocumentTreeRow from '@/features/documents/components/DocumentTreeRow';
import type { VaultTreeNode } from '@/features/documents/utils/vaultTree';
import { hasTreeContent } from './treeContent';

describe('tree chevrons', () => {
  it('hides the chevron for empty branches and empty fragments', () => {
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
  });

  it('shows the chevron when a child exists', () => {
    assert.equal(
      hasTreeContent(
        <>
          <span>Child</span>
        </>,
      ),
      true,
    );
  });

  it('renders no chevron or expanded state for an empty group', () => {
    const empty = renderToStaticMarkup(
      <ProjectGroup projectKey="VOL" projectName="Volition" count={0}>
        <span>Hidden</span>
      </ProjectGroup>,
    );
    const filled = renderToStaticMarkup(
      <ProjectGroup projectKey="VOL" projectName="Volition" count={1}>
        <span>Visible</span>
      </ProjectGroup>,
    );
    assert.doesNotMatch(empty, /lucide-chevron-right/);
    assert.doesNotMatch(empty, /aria-expanded/);
    assert.match(filled, /aria-expanded="true"/);
  });

  it('hides the chevron on an empty knowledge folder', () => {
    const folder: VaultTreeNode = {
      item: { path: 'Home/Empty', name: 'Empty', kind: 'folder', title: 'Empty', updatedAt: null },
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
    assert.doesNotMatch(empty, /lucide-chevron-right/);
    assert.doesNotMatch(empty, /aria-expanded/);
    assert.match(filled, /lucide-chevron-right/);
  });
});
