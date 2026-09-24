/**
 * The demo organization: what scripts/helena-demo/seed.ts creates.
 *
 * Two projects, each with its coordinator (Helena creates it with the project) and
 * specialists copied from pool templates, a handful of tasks, one weekly routine and one
 * builder workflow. Everything is named so a person sees at once it is sample data, and so
 * the seed finds it again on the next run (keys, titles and names are the identity).
 */

export interface DemoTask {
  title: string;
  description: string;
}

export interface DemoProject {
  key: string;
  name: string;
  description: string;
  preset: 'general' | 'software';
  // Pool template names (bundles/agent-pool/agents/<name>.md) copied into the project as
  // its specialists.
  specialists: string[];
  tasks: DemoTask[];
}

export const DEMO_PROJECTS: DemoProject[] = [
  {
    key: 'SITE',
    name: 'Demo: Website relaunch',
    description:
      'Sample project. A small crew researches, writes and reviews the pages of a website ' +
      'relaunch. Delete it whenever you like.',
    preset: 'software',
    specialists: ['researcher', 'tech-writer', 'qa'],
    tasks: [
      {
        title: 'Compare three static site generators for the relaunch',
        description:
          'Compare Astro, Eleventy and Hugo for a 20-page marketing site: build speed, ' +
          'content editing, image handling and hosting. End with a recommendation and sources.',
      },
      {
        title: 'Write the "About us" page',
        description:
          'Draft the About page from the notes in Docs: who we are, what we do, how to reach ' +
          'us. Plain language, at most 300 words.',
      },
      {
        title: 'Check every page for broken links',
        description:
          'Go through the staging site and list broken links and missing images, with the ' +
          'page each one is on.',
      },
    ],
  },
  {
    key: 'OPS',
    name: 'Demo: Operations',
    description:
      'Sample project for recurring work: a weekly status report and a planning crew. ' +
      'Delete it whenever you like.',
    preset: 'general',
    specialists: ['planner', 'researcher'],
    tasks: [
      {
        title: 'Break the Q4 goals into tasks',
        description:
          'Turn the three Q4 goals in Docs into tasks with acceptance criteria and an order.',
      },
      {
        title: "Collect this week's open questions",
        description: 'List the open questions from the tasks of the last week, grouped by project.',
      },
    ],
  },
];

export const DEMO_ROUTINE = {
  projectKey: 'OPS',
  title: 'Weekly status report',
  instructions:
    'Write a short status report for the week: what was finished, what is blocked and why, ' +
    'what starts next week. Link the tasks you mention.',
  cron: '0 9 * * 1',
  // Fixed so a second seed run finds the routine instead of creating another one.
  idempotencyKey: '3b0f4c2e-6f7a-4d1e-9a51-6e2d8c7b9a10',
};

export const DEMO_WORKFLOW = {
  projectKey: 'SITE',
  name: 'Research, write, review',
  description:
    'Sample workflow: the researcher collects facts, the writer drafts the page, you approve ' +
    'the draft, and the result lands on the task as a comment.',
  definition: {
    schemaVersion: 1,
    trigger: { type: 'manual' },
    roles: [
      {
        key: 'researcher',
        name: 'Researcher',
        match: { type: 'capability', capability: 'research' },
      },
      { key: 'writer', name: 'Writer', match: { type: 'capability', capability: 'docs' } },
    ],
    steps: [
      {
        id: 'research',
        name: 'Research the topic',
        type: 'agent',
        assignee: { role: 'researcher' },
        instruction:
          'Research what task {{task.identifier}} "{{task.title}}" needs. Collect facts with ' +
          'sources, no prose.\n\n{{task.description}}',
        maxTurns: null,
        runBudgetSeconds: null,
        model: null,
        timeoutMinutes: 60,
      },
      {
        id: 'draft',
        name: 'Write the draft',
        type: 'agent',
        assignee: { role: 'writer' },
        instruction:
          'Write the text task {{task.identifier}} "{{task.title}}" asks for, from this ' +
          'research:\n\n{{step.research.summary}}',
        maxTurns: null,
        runBudgetSeconds: null,
        model: null,
        timeoutMinutes: 60,
      },
      {
        id: 'approve',
        name: 'Approve the draft',
        type: 'approval',
        message: 'Is the draft of {{task.identifier}} ready to publish?',
        onReject: { action: 'goto', stepId: 'draft', maxLoops: 2 },
      },
      {
        id: 'report',
        name: 'Post the approved draft',
        type: 'action',
        action: { kind: 'comment', body: '## Approved draft\n\n{{step.draft.summary}}' },
      },
    ],
  },
};
