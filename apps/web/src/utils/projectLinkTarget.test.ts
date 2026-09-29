import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectLinkTarget } from './projectLinkTarget';

const origin = 'https://helena.example';

describe('project links', () => {
  it('keeps links in the current project as normal navigation', () => {
    assert.equal(projectLinkTarget('/project/TRADE/issue/4', 'TRADE', origin), null);
  });

  it('opens another project in the sheet before switching', () => {
    assert.deepEqual(projectLinkTarget('/project/OTHER/issue/4?from=inbox', 'TRADE', origin), {
      key: 'OTHER',
      href: '/project/OTHER/issue/4?from=inbox',
      issue: 4,
    });
  });

  it('names the task of a task link, and no task for other pages', () => {
    assert.equal(projectLinkTarget('/project/OTHER/issue/12', null, origin)?.issue, 12);
    assert.equal(projectLinkTarget('/project/OTHER/activity', 'TRADE', origin)?.issue, undefined);
    assert.equal(projectLinkTarget('/project/OTHER/issue/12/x', 'TRADE', origin)?.issue, undefined);
  });

  it('on the Helena pages goes straight to a project page, a task still opens over the page', () => {
    assert.equal(projectLinkTarget('/project/TRADE', null, origin), null);
    assert.equal(projectLinkTarget('/project/TRADE/ai-team/schedules?edit=x', null, origin), null);
    assert.equal(projectLinkTarget('/project/TRADE/issue/3', null, origin)?.issue, 3);
  });

  it('leaves external and Home URLs alone', () => {
    assert.equal(projectLinkTarget('https://other.example/project/OTHER', 'TRADE', origin), null);
    assert.equal(projectLinkTarget('/', 'TRADE', origin), null);
  });
});
