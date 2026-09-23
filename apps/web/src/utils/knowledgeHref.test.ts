import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { knowledgeHref } from './knowledgeHref';

describe('knowledgeHref', () => {
  it('opens a note in the Docs of its project or of Home', () => {
    assert.equal(
      knowledgeHref('Projects/VOL/Docs/A b.md', 'note'),
      '/project/VOL/docs?path=Projects%2FVOL%2FDocs%2FA%20b.md',
    );
    assert.equal(knowledgeHref('Home/Docs/Ideas.md', 'note'), '/docs?path=Home%2FDocs%2FIdeas.md');
  });

  it('opens a project file in the Files page at its folder, any other file as a download', () => {
    assert.equal(
      knowledgeHref('Projects/VOL/Files/Tasks/scan.pdf', 'file'),
      '/project/VOL/files?path=Files%2FTasks',
    );
    assert.equal(
      knowledgeHref('Home/Files/x.pdf', 'file'),
      '/protected-media/knowledge/raw?path=Home%2FFiles%2Fx.pdf',
    );
  });
});
