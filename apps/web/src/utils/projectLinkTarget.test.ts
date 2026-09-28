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
    });
  });

  it('leaves external and Home URLs alone', () => {
    assert.equal(projectLinkTarget('https://other.example/project/OTHER', 'TRADE', origin), null);
    assert.equal(projectLinkTarget('/', 'TRADE', origin), null);
  });
});
