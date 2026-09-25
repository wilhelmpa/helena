import { describe, it, expect } from 'bun:test';
import {
  framePrompt,
  peopleContext,
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

describe('a mention run', () => {
  const run: RunForPrompt = {
    id: 9,
    trigger: 'mention',
    prompt: '@lead please hand this to @qa and ask @qa to write the test plan',
    issueId: 12,
    issueIdentifier: 'MKT-4',
    issueTitle: 'Offer',
    issueArea: null,
    issueAreaFolder: null,
    assigneeName: null,
    assigneeUsername: null,
    requesterName: 'Pat',
    requesterUsername: 'pat',
    agentUserId: 'agent-user',
    agentUsername: 'lead',
    threadContext: null,
    sourceActivityId: 40,
  };

  // Each agent a comment tags does only its own part (E2E test: the specialist tagged
  // next to its coordinator did the handing over itself as well).
  it('names the other agents the comment tags and leaves their part to them', () => {
    const text = framePrompt(run);
    expect(text).toContain('The comment also tags @qa. Do only what it asks');
    expect(text).toContain('work handed to you reaches you as a task of its own');
  });

  it('adds nothing when the comment tags only this agent', () => {
    const text = framePrompt({ ...run, prompt: '@lead please look at this' });
    expect(text).not.toContain('The comment also tags');
  });
});

// A routine's work is read in its task, not announced (docs/helena-decisions/
// routine-mentions.md): in the E2E test every run of a routine tagged the owner, because a
// delegation with no assignee said to tag a project owner.
describe('a routine run', () => {
  const routine = {
    title: 'Weekly check',
    delegateUsername: 'writer',
    startedUsernames: ['coder', 'seo'],
  };
  const delegation: RunForPrompt = {
    id: 21,
    trigger: 'delegation',
    prompt: 'MKT-9 Weekly check',
    issueId: 30,
    issueIdentifier: 'MKT-9',
    issueTitle: 'Weekly check',
    issueArea: null,
    issueAreaFolder: null,
    assigneeName: null,
    assigneeUsername: null,
    requesterName: null,
    requesterUsername: null,
    agentUserId: 'writer-user',
    agentUsername: 'writer',
    threadContext: null,
    sourceActivityId: null,
    routine,
  };
  const instructions = 'Montags: @coder prüf die Abhängigkeiten, @seo fasse zusammen.';
  const mention: RunForPrompt = {
    ...delegation,
    id: 22,
    trigger: 'mention',
    prompt: instructions,
    agentUserId: 'coder-user',
    agentUsername: 'coder',
  };

  it('delegates without telling the agent to tag anyone', () => {
    const text = framePrompt(delegation);
    expect(text).toContain('comes from the routine "Weekly check"');
    expect(text).toContain('tag nobody in your comments');
    expect(text).toContain('mark_issue_blocked');
    expect(text).not.toContain('tag a project owner');
    expect(text).not.toContain('tag the responsible assignee');
    // The same issue without a routine still asks for one person to be tagged.
    expect(framePrompt({ ...delegation, routine: null })).toContain('tag a project owner');
  });

  it('names the agents the routine started beside the delegate, so it leaves their part', () => {
    const text = framePrompt(delegation);
    expect(text).toContain('The routine also started @coder, @seo on this issue');
    expect(text).toContain('do not hand their parts to them again');
    const alone = framePrompt({ ...delegation, routine: { ...routine, startedUsernames: [] } });
    expect(alone).not.toContain('also started');
  });

  it('frames a mentioned agent with the instructions, its delegate and the others', () => {
    const text = framePrompt(mention);
    expect(text).toContain('The routine "Weekly check" of your project names you');
    expect(text).toContain(
      'Working on it besides you: @writer, to whom the issue is delegated; @seo.',
    );
    expect(text).toContain("Leave the issue's status to the agent it is delegated to.");
    expect(text).toContain('tag nobody in your comments');
    expect(text).toContain(`The routine's instructions:\n\n${instructions}`);
    expect(text).not.toContain('The comment that mentioned you');
  });

  it('frames a mention a person wrote on the routine task as a comment again', () => {
    const text = framePrompt({ ...mention, sourceActivityId: 40, routine: null });
    expect(text).toContain('You were mentioned in a comment');
  });

  it('names the people without the advice to tag them', () => {
    const people = peopleContext({
      ...mention,
      assigneeName: 'Pat',
      assigneeUsername: 'pat',
    });
    expect(people).toContain('The issue is assigned to Pat (@pat)');
    expect(people).not.toContain('Tag the responsible assignee');
    expect(people).not.toContain('To mention a person');
    const ordinary = peopleContext({
      ...mention,
      routine: null,
      assigneeName: 'Pat',
      assigneeUsername: 'pat',
    });
    expect(ordinary).toContain('Tag the responsible assignee');
  });
});
