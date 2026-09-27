import { describe, expect, it } from 'bun:test';
import { shouldResumeParent, subtaskResumePrompt } from '../../subtask-resume';

const eligible = {
  childParentId: 4,
  childDelegateUserId: 'specialist',
  previousColumnId: 1,
  currentColumnId: 2,
  childStateType: 'completed',
  parentStateType: 'started',
  parentDelegateUserId: 'coordinator',
  parentArchived: false,
  actorUserId: 'specialist',
};

describe('subtask parent resume', () => {
  it('resumes an open parent when its delegated child completes or is canceled', () => {
    expect(shouldResumeParent(eligible)).toBe(true);
    expect(shouldResumeParent({ ...eligible, childStateType: 'canceled' })).toBe(true);
  });

  it.each([
    { previousColumnId: 2 },
    { childStateType: 'started' },
    { childParentId: null },
    { childDelegateUserId: null },
    { parentDelegateUserId: null },
    { parentStateType: 'completed' },
    { parentStateType: 'canceled' },
    { parentArchived: true },
    { actorUserId: 'coordinator' },
  ])('does not resume for an ineligible update: %j', (change) => {
    expect(shouldResumeParent({ ...eligible, ...change })).toBe(false);
  });

  it('includes the child id, final status and result comment in the parent run', () => {
    const prompt = subtaskResumePrompt({
      childIdentifier: 'HELENA-17',
      childTitle: 'Implement parent resume',
      childStateType: 'completed',
      resultComment: 'Branch hub/subtask-parent-resume; targeted tests pass.',
    });
    expect(prompt).toContain('HELENA-17');
    expect(prompt).toContain('completed');
    expect(prompt).toContain('Branch hub/subtask-parent-resume; targeted tests pass.');
  });

  it('bounds the result comment passed to the agent', () => {
    const prompt = subtaskResumePrompt({
      childIdentifier: 'HELENA-17',
      childTitle: 'Implement parent resume',
      childStateType: 'completed',
      resultComment: 'x'.repeat(2_100),
    });
    expect(prompt).toContain('x'.repeat(2_000));
    expect(prompt).not.toContain('x'.repeat(2_001));
  });
});
