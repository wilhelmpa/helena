import type { PipelineDefinition } from './definition';

// The templates Plan ships. The web adds one to a team's library in the member's
// language; the step names below are the English ones.

const agentTeam: PipelineDefinition = {
  schemaVersion: 1,
  trigger: { type: 'manual' },
  roles: [
    { key: 'coordinator', name: 'Coordinator', match: { type: 'coordinator' } },
    { key: 'specialist', name: 'Specialist', match: { type: 'none' } },
  ],
  steps: [
    {
      id: 'plan',
      name: 'Coordinator plans the work',
      type: 'agent',
      assignee: { role: 'coordinator' },
      instruction:
        'Plan the work on task {{task.identifier}} "{{task.title}}" for the specialist. Split it ' +
        'into concrete steps and name the acceptance criteria. Do not do the work yourself.\n\n' +
        '{{task.description}}',
      maxTurns: null,
      runBudgetSeconds: null,
      model: null,
      timeoutMinutes: 60,
    },
    {
      id: 'implement',
      name: 'Specialist does the work',
      type: 'agent',
      assignee: { role: 'specialist' },
      instruction:
        'Carry out the plan of the coordinator for task {{task.identifier}} "{{task.title}}".\n\n' +
        'Plan:\n{{step.plan.summary}}\n\n' +
        'End with what you changed and how you checked it.',
      maxTurns: null,
      runBudgetSeconds: null,
      model: null,
      timeoutMinutes: 120,
    },
    {
      id: 'review',
      name: 'Coordinator reviews the result',
      type: 'agent',
      assignee: { role: 'coordinator' },
      instruction:
        'Review the result of the specialist on task {{task.identifier}} against the plan and ' +
        'its acceptance criteria. Start your answer with ACCEPTED or CHANGES NEEDED, then give ' +
        'your notes.\n\nPlan:\n{{step.plan.summary}}\n\nResult:\n{{step.implement.summary}}',
      maxTurns: null,
      runBudgetSeconds: null,
      model: null,
      timeoutMinutes: 60,
    },
    {
      id: 'accepted',
      name: 'Review accepted?',
      type: 'condition',
      condition: { kind: 'keyword', keyword: 'ACCEPTED' },
      then: [
        {
          id: 'report-accepted',
          name: 'Report the accepted result',
          type: 'action',
          action: {
            kind: 'comment',
            body: '## Agent team result\n\n{{step.implement.summary}}\n\n### Review\n\n{{step.review.summary}}',
          },
        },
      ],
      else: [
        {
          id: 'report-changes',
          name: 'Report the requested changes',
          type: 'action',
          action: {
            kind: 'comment',
            body: '## Agent team result: changes needed\n\n{{step.review.summary}}',
          },
        },
      ],
      thenEnd: false,
      elseEnd: false,
    },
    {
      id: 'to-review',
      name: 'Move the task to Review',
      type: 'action',
      action: { kind: 'set_status', status: 'Review' },
    },
  ],
};

const releaseNotes: PipelineDefinition = {
  schemaVersion: 1,
  trigger: { type: 'manual' },
  roles: [
    { key: 'coder', name: 'Coder', match: { type: 'none' } },
    { key: 'writer', name: 'Content agent', match: { type: 'none' } },
  ],
  steps: [
    {
      id: 'implement',
      name: 'Coder implements',
      type: 'agent',
      assignee: { role: 'coder' },
      instruction:
        'Implement task {{task.identifier}} "{{task.title}}".\n\n{{task.description}}\n\n' +
        'End with a summary of the changes.',
      maxTurns: null,
      runBudgetSeconds: null,
      model: null,
      timeoutMinutes: 120,
    },
    {
      id: 'approve',
      name: 'Approval',
      type: 'approval',
      message:
        'Approve the implementation of {{task.identifier}} "{{task.title}}":\n\n{{previous.summary}}',
      onReject: { action: 'goto', stepId: 'implement', maxLoops: 3 },
    },
    {
      id: 'release-notes',
      name: 'Content agent writes release notes',
      type: 'agent',
      assignee: { role: 'writer' },
      instruction:
        'Write release notes for task {{task.identifier}} "{{task.title}}" from this summary of ' +
        'the changes:\n\n{{step.implement.summary}}\n\nNote of the approver: {{step.approve.note}}',
      maxTurns: null,
      runBudgetSeconds: null,
      model: null,
      timeoutMinutes: 60,
    },
    {
      id: 'post-notes',
      name: 'Post the release notes',
      type: 'action',
      action: { kind: 'comment', body: '## Release notes\n\n{{previous.summary}}' },
    },
  ],
};

export const BUILTIN_TEMPLATES = [
  {
    key: 'agent-team',
    name: 'Agent team (default)',
    description:
      'The coordinator plans, a specialist does the work, the coordinator reviews it, and the ' +
      'task moves to Review.',
    definition: agentTeam,
  },
  {
    key: 'release-notes',
    name: 'Implement, approve, release notes',
    description:
      'A coder implements the task, you approve it or send it back, and a content agent writes ' +
      'the release notes.',
    definition: releaseNotes,
  },
];
