import { describe, it, expect } from 'bun:test';
import {
  framePrompt,
  projectPreamble,
  runModePreamble,
  type RunForPrompt,
} from '../../prompt/framing';
import { PROJECT_DESCRIPTION_LIMIT } from '#modules/projects/model';

describe('projectPreamble', () => {
  it('adds the description as its own paragraph', () => {
    const text = projectPreamble({ key: 'MKT', name: 'Marketing', description: 'Growth work' });
    expect(text).toContain('\n\nGrowth work\n');
  });

  it('adds nothing when the description is empty', () => {
    const text = projectPreamble({ key: 'MKT', name: 'Marketing', description: '  ' });
    expect(text.endsWith('-123.\n\n')).toBe(true);
  });

  it('cuts a description longer than the limit', () => {
    const description = 'x'.repeat(PROJECT_DESCRIPTION_LIMIT + 100);
    const text = projectPreamble({ key: 'MKT', name: 'Marketing', description });
    expect(text).toContain('x'.repeat(PROJECT_DESCRIPTION_LIMIT));
    expect(text).not.toContain('x'.repeat(PROJECT_DESCRIPTION_LIMIT + 1));
  });
});

describe('an approval run', () => {
  const run: RunForPrompt = {
    id: 7,
    trigger: 'approval',
    prompt: 'Approval request #3 (send): Send the offer\nDecision: rejected by Pat\nNote: Not yet',
    issueId: 12,
    issueIdentifier: 'MKT-4',
    issueTitle: 'Offer',
    issueArea: null,
    issueAreaFolder: null,
    assigneeName: null,
    assigneeUsername: null,
    requesterName: null,
    requesterUsername: null,
    agentUserId: 'agent-user',
    agentUsername: 'ext',
    threadContext: null,
    sourceActivityId: null,
  };

  it('carries the decision, the issue and what to do with either outcome', () => {
    const text = framePrompt(run);
    expect(text).toContain('issue MKT-4 "Offer"');
    expect(text).toContain('Decision: rejected by Pat\nNote: Not yet');
    expect(text).toContain('If it was rejected, do not carry the action out');
    expect(text).toContain('add_comment tool\n(issueId 12)');
  });

  it('names the area and its folder', () => {
    const text = framePrompt({ ...run, issueArea: 'Backend', issueAreaFolder: 'backend' });
    expect(text).toContain('Area: Backend (folder backend)');
  });

  it('names no issue and asks for no comment when the request had none', () => {
    const text = framePrompt({ ...run, issueId: null, issueIdentifier: null, issueTitle: null });
    expect(text).not.toContain('issue');
    expect(text).not.toContain('add_comment');
  });

  it('says the run follows a decision', () => {
    expect(runModePreamble('approval')).toContain('decided on your approval request');
  });
});
