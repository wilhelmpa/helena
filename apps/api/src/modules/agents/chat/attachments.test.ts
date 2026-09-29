import { describe, expect, it } from 'bun:test';
import { questionText, resolvePageContext } from './attachments';

describe('Home chat page context', () => {
  it('passes the current project and page to the agent without changing the question', () => {
    expect(
      questionText('Warum ist diese Aufgabe blockiert?', [
        { kind: 'page', projectKey: 'TRADE', path: '/project/TRADE/issue/42' },
      ]),
    ).toContain('Current Ava page: /project/TRADE/issue/42\nCurrent project: TRADE');
  });

  it('rejects a project URL without a project context', async () => {
    await expect(
      resolvePageContext({ id: 'test-user' }, { projectKey: null, path: '/project/OTHER/issue/1' }),
    ).rejects.toThrow('Page context needs a project');
  });
});
