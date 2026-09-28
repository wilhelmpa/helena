// Run with the API service environment and an active project runner:
// bun apps/api/src/scripts/eval-helena-mcp.ts --project-key P6BROW26 --agent-id 74
//   --model helena-local/Qwen3.6-35B-A3B-MTP-GGUF --model gpt-6-luna
//   --output /tmp/helena-mcp-eval
// Omit --project-key and --agent-id to provision a disposable project and its agents.
// --dry uses a *_test or *_eval database and never queues an agent run.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  agentRun,
  agentRunEvent,
  aiAgent,
  cycle,
  db,
  helenaDecision,
  helenaGoalTask,
  helenaReceipt,
  helenaSchedule,
  initiative,
  issue,
  issueActivity,
  issueChecklist,
  issueChecklistItem,
  issueLink,
  mailAccount,
  mailMessage,
  mailThread,
  organizationGoal,
  project,
  projectColumn,
  projectDeprovisioningJob,
  projectMember,
  team,
  teamMember,
  user,
  vaultEntry,
} from '@repo/db';
import { absoluteVaultPath, indexVaultPaths, writeVaultFile } from '@repo/vault';
import { hermesProjectCoordinatorUsername } from '@repo/agent-naming';
import { isLocalProvider } from '@helena/sdk';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createProject, deleteProject, getProvisioningJob } from '#modules/projects/service';
import { createAgent, deleteAgent } from '#modules/agents/core/service';
import { setProjectLevel } from '#modules/autopilot/levels';
import { enqueueAgentRun } from '#modules/agents/core/run-queue';
import { sameModel } from '#modules/agents/runtime-sync/model-check';
import { waitForBlueprintProvisioning } from '#modules/project-blueprints/provisioning';

type ClassId = 'tickets' | 'knowledge' | 'planning' | 'mail' | 'finance' | 'decisions';
type Case = { number: number; name: string; classId: ClassId; prompt: (seed: Seed) => string };
type Seed = {
  tag: string;
  projectId: number;
  key: string;
  teamId: number;
  agentId: number;
  agentUserId: string;
  targetAgentUserId: string;
  targetUsername: string;
  columns: { open: number; done: number };
  issues: { a: number; b: number; c: number; evidence: number };
  issueNumbers: { a: number; b: number; c: number; evidence: number };
  goalId: number;
  checklistId: number;
  codes: {
    search: string;
    file: string;
    answer: string;
    mail: string;
    receipt: string;
    decision: string;
  };
  vaultPaths: string[];
};
type Owned = {
  key: string;
  projectId: number | null;
  createdProject: boolean;
  targetAgentId: number | null;
  targetUsername: string | null;
  issueIds: number[];
  goalId: number | null;
  cycleId: number | null;
  scheduleId: string | null;
  mailAccountId: number | null;
  decisionId: number | null;
  receiptId: number | null;
  fixtureDirectory: string | null;
  tag: string;
};
type Row = {
  task: number;
  name: string;
  classId: ClassId;
  model: string;
  passed: boolean;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  toolCalls: number;
  mcpToolCalls: number;
  error: string | null;
  runId: number | null;
};

const ref = (seed: Seed, issue: keyof Seed['issueNumbers']) =>
  `${seed.key}-${seed.issueNumbers[issue]}`;

const cases: Case[] = [
  {
    number: 1,
    name: 'Create ticket',
    classId: 'tickets',
    prompt: (s) => `Create a ticket in ${s.key} titled "Eval intake ${s.tag}".`,
  },
  {
    number: 2,
    name: 'Set status',
    classId: 'tickets',
    prompt: (s) => `Move ${ref(s, 'b')} to the completed state.`,
  },
  {
    number: 3,
    name: 'Comment',
    classId: 'tickets',
    prompt: (s) => `Comment "Reviewed ${s.key}" on ${ref(s, 'a')}.`,
  },
  {
    number: 4,
    name: 'Delegate',
    classId: 'tickets',
    prompt: (s) => `Delegate ${ref(s, 'c')} to @${s.targetUsername}.`,
  },
  {
    number: 5,
    name: 'Subtask',
    classId: 'tickets',
    prompt: (s) => `Create a subtask titled "Eval child ${s.tag}" under ${ref(s, 'a')}.`,
  },
  {
    number: 6,
    name: 'Search knowledge',
    classId: 'knowledge',
    prompt: (s) =>
      `Search project ${s.key} knowledge for the saffron access code in ${s.vaultPaths[0]}. Comment only that code on ${ref(s, 'evidence')}.`,
  },
  {
    number: 7,
    name: 'Read file',
    classId: 'knowledge',
    prompt: (s) => `Read ${s.vaultPaths[1]} and comment its file code on ${ref(s, 'evidence')}.`,
  },
  {
    number: 8,
    name: 'Write document',
    classId: 'knowledge',
    prompt: (s) => `Write ${s.vaultPaths[3]} with the line "Eval document ${s.key}".`,
  },
  {
    number: 9,
    name: 'Link goal',
    classId: 'planning',
    prompt: (s) => `Link ${ref(s, 'b')} to the project goal "Eval delivery ${s.tag}".`,
  },
  {
    number: 10,
    name: 'Read decision log',
    classId: 'decisions',
    prompt: (s) =>
      `Read the decision log entry for ${s.key}:${s.tag}. Comment its choice on ${ref(s, 'evidence')}. If the log is inaccessible, say so.`,
  },
  {
    number: 11,
    name: 'List schedules',
    classId: 'planning',
    prompt: (s) =>
      `List the routines of ${s.key}. Comment the cron of the routine named "Eval weekly ${s.tag}" on ${ref(s, 'evidence')}.`,
  },
  {
    number: 12,
    name: 'Answer from docs',
    classId: 'knowledge',
    prompt: (s) =>
      `According to ${s.vaultPaths[0]}, what is the launch constellation? Comment only the answer on ${ref(s, 'evidence')}.`,
  },
  {
    number: 13,
    name: 'Classify mail',
    classId: 'mail',
    prompt: (s) =>
      `Read the mail titled "Eval sample mail ${s.tag}" in ${s.key}. Classify it as invoice, support request, or advertisement. Comment the category and its reference on ${ref(s, 'evidence')}. Do not send mail.`,
  },
  {
    number: 14,
    name: 'Recognize receipt',
    classId: 'finance',
    prompt: (s) =>
      `Read the sample receipt file in ${s.vaultPaths[2]}. Comment the gross amount, including currency, on ${ref(s, 'evidence')}.`,
  },
  {
    number: 15,
    name: 'Set priority',
    classId: 'tickets',
    prompt: (s) => `Set priority of ${ref(s, 'a')} to high.`,
  },
  {
    number: 16,
    name: 'Set due date',
    classId: 'tickets',
    prompt: (s) => `Set due date of ${ref(s, 'c')} to 2027-03-17.`,
  },
  {
    number: 17,
    name: 'Create checklist',
    classId: 'tickets',
    prompt: (s) => `Create a checklist titled "Eval checks ${s.tag}" on ${ref(s, 'a')}.`,
  },
  {
    number: 18,
    name: 'Add checklist item',
    classId: 'tickets',
    prompt: (s) =>
      `Add "Verify sample ${s.key}" to the existing "Eval base checklist" on ${ref(s, 'a')}.`,
  },
  {
    number: 19,
    name: 'Create initiative',
    classId: 'planning',
    prompt: (s) => `Create an initiative titled "Eval expansion ${s.tag}" in ${s.key}.`,
  },
  {
    number: 20,
    name: 'Link tickets',
    classId: 'tickets',
    prompt: (s) => `Record that ${ref(s, 'a')} blocks ${ref(s, 'c')}.`,
  },
];

const requiredMcpTools: Record<number, string[]> = {
  1: ['create_issue'],
  2: ['update_issue'],
  3: ['add_comment'],
  4: ['update_issue'],
  5: ['create_issue'],
  6: ['search_knowledge'],
  7: ['read_document', 'read_knowledge'],
  8: ['write_note'],
  9: ['link_issue_to_goal'],
  10: [],
  11: ['list_routines'],
  12: ['search_knowledge', 'read_document', 'read_knowledge'],
  13: ['read_mail', 'read_knowledge'],
  14: ['read_document', 'read_knowledge'],
  15: ['update_issue'],
  16: ['update_issue'],
  17: ['create_checklist'],
  18: ['create_checklist_item'],
  19: ['create_initiative'],
  20: ['link_issues'],
};

function option(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : (process.argv[at + 1] ?? null);
}

function models(): string[] {
  const result: string[] = [];
  for (let at = 0; at < process.argv.length; at++) {
    if (process.argv[at] === '--model' && process.argv[at + 1]) result.push(process.argv[++at]!);
  }
  return [...new Set(result)];
}

function assertOptions(dry: boolean, selected: number | null, selectedModels: string[]) {
  const projectKey = option('project-key');
  const agentId = option('agent-id');
  if (selected !== null && (!Number.isInteger(selected) || selected < 1 || selected > 20)) {
    throw new Error('--only must be an integer from 1 to 20');
  }
  if (!dry && selectedModels.length === 0) throw new Error('Provide at least one --model');
  if ((projectKey === null) !== (agentId === null)) {
    throw new Error('--project-key and --agent-id must be passed together');
  }
  if (projectKey !== null && !/^[A-Z][A-Z0-9]{1,19}$/.test(projectKey)) {
    throw new Error('--project-key must be an uppercase project key');
  }
  if (agentId !== null && (!Number.isSafeInteger(Number(agentId)) || Number(agentId) < 1)) {
    throw new Error('--agent-id must be a positive integer');
  }
  if (projectKey !== null && process.argv.includes('--keep')) {
    throw new Error('--keep is only available for projects created by this script');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!process.env.PROJECT_VAULT_ROOT) throw new Error('PROJECT_VAULT_ROOT is required');
  if (dry && !new URL(process.env.DATABASE_URL).pathname.match(/(?:_test|_eval)$/)) {
    throw new Error('--dry requires a database whose name ends in _test or _eval');
  }
}

async function ownerForRun(
  dry: boolean,
  requiredTeamId?: number,
): Promise<{ teamId: number; ownerId: string; temporary: boolean }> {
  const teamOption = option('team');
  if (teamOption && (!Number.isInteger(Number(teamOption)) || Number(teamOption) < 1)) {
    throw new Error('--team must be a positive integer');
  }
  const homes = teamOption
    ? []
    : await db
        .select({ teamId: aiAgent.teamId })
        .from(aiAgent)
        .where(eq(aiAgent.username, 'master'));
  const wanted =
    requiredTeamId ??
    (teamOption ? Number(teamOption) : homes.length === 1 ? homes[0]!.teamId : null);
  if (requiredTeamId && teamOption && Number(teamOption) !== requiredTeamId) {
    throw new Error('--team does not own --project-key');
  }
  const owners = await db
    .select({ teamId: teamMember.teamId, ownerId: teamMember.userId })
    .from(teamMember)
    .where(and(eq(teamMember.role, 'owner'), wanted ? eq(teamMember.teamId, wanted) : undefined));
  if (owners.length === 1 || (wanted !== null && owners.length > 0)) {
    const [selectedTeam] = await db
      .select({ mcpEnabled: team.mcpEnabled })
      .from(team)
      .where(eq(team.id, owners[0]!.teamId));
    if (!dry && !selectedTeam?.mcpEnabled) throw new Error('Helena MCP is disabled for this team');
    return { ...owners[0]!, temporary: false };
  }
  if (owners.length > 1) throw new Error('Multiple team owners found; pass --team <id>');
  if (!dry || wanted) throw new Error('No team owner found');
  const ownerId = randomUUID();
  await db
    .insert(user)
    .values({ id: ownerId, name: 'Eval fixture', email: `${ownerId}@eval.invalid`, role: 'user' });
  const [created] = await db
    .insert(team)
    .values({ name: 'Eval fixture' })
    .returning({ id: team.id });
  await db.insert(teamMember).values({ teamId: created!.id, userId: ownerId, role: 'owner' });
  return { teamId: created!.id, ownerId, temporary: true };
}

async function waitForRunner(
  agentId: number,
  key: string,
  provisionedAt: number,
  timeoutMs = 180_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [agent] = await db
      .select({ runtimeState: aiAgent.runtimeState, lastSeenAt: aiAgent.lastSeenAt })
      .from(aiAgent)
      .where(eq(aiAgent.id, agentId));
    if (!agent) throw new Error(`Agent ${agentId} disappeared while waiting for its runner`);
    const state = agent.runtimeState as { status?: string };
    if (
      state.status === 'online' &&
      agent.lastSeenAt &&
      agent.lastSeenAt.getTime() >= provisionedAt &&
      Date.now() - agent.lastSeenAt.getTime() < 180_000
    ) {
      return;
    }
    await Bun.sleep(2000);
  }
  throw new Error(
    `Agent ${agentId} in ${key} has no online runner or recent heartbeat after ${timeoutMs / 1000}s; no evaluation task was started`,
  );
}

async function seedProject(
  key: string,
  owner: {
    teamId: number;
    ownerId: string;
    temporary: boolean;
  },
  dry: boolean,
  existingAgentId: number | null,
  owned: Owned,
): Promise<Seed> {
  const createdProject = existingAgentId === null;
  const projectRow = createdProject
    ? await createProject(
        { key, name: 'EVAL', description: 'Disposable Helena MCP evaluation', locale: 'en' },
        owner.ownerId,
        owner.teamId,
      )
    : (
        await db
          .select({ id: project.id, teamId: project.teamId, mcpEnabled: project.mcpEnabled })
          .from(project)
          .where(and(eq(project.key, key), eq(project.teamId, owner.teamId)))
      )[0];
  if (!projectRow) throw new Error(`Project ${key} is not in team ${owner.teamId}`);
  owned.projectId = projectRow.id;
  if (!projectRow.mcpEnabled && !dry) {
    throw new Error(`Project ${key} has Helena MCP disabled`);
  }
  if (createdProject) await setProjectLevel(projectRow.id, 3, owner.ownerId);
  if (!dry) await waitForBlueprintProvisioning(projectRow.id, key, console.log);
  const [agent] = await db
    .select({
      id: aiAgent.id,
      userId: aiAgent.userId,
      kind: aiAgent.kind,
      pausedAt: aiAgent.pausedAt,
    })
    .from(aiAgent)
    .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
    .where(
      and(
        eq(aiAgent.teamId, owner.teamId),
        eq(projectMember.projectId, projectRow.id),
        existingAgentId === null
          ? eq(aiAgent.username, hermesProjectCoordinatorUsername(key))
          : eq(aiAgent.id, existingAgentId),
      ),
    )
    .orderBy(sql`${aiAgent.id} DESC`)
    .limit(1);
  if (!agent || agent.kind !== 'external' || agent.pausedAt) {
    throw new Error(`Agent ${existingAgentId ?? 'coordinator'} is unavailable in ${key}`);
  }
  const memberships = await db
    .select({ projectId: projectMember.projectId })
    .from(projectMember)
    .where(eq(projectMember.userId, agent.userId));
  if (memberships.length !== 1) {
    throw new Error(`Agent ${agent.id} must work in exactly one project for its Hermes runner`);
  }
  const [existingTarget] = createdProject
    ? []
    : await db
        .select({ username: aiAgent.username, userId: aiAgent.userId })
        .from(aiAgent)
        .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
        .where(
          and(
            eq(projectMember.projectId, projectRow.id),
            sql`${aiAgent.id} <> ${agent.id}`,
            eq(aiAgent.triggerOnAssign, false),
          ),
        )
        .limit(1);
  const targetUsername = existingTarget?.username ?? `eval-target-${owned.tag}`;
  if (!existingTarget) owned.targetUsername = targetUsername;
  const createdTarget = !existingTarget
    ? await createAgent(owner.teamId, {
        name: 'Eval target',
        username: targetUsername,
        projectId: projectRow.id,
        ownerUserId: owner.ownerId,
        triggerOnAssign: false,
        triggerOnMention: false,
      })
    : null;
  owned.targetAgentId = createdTarget?.agent.id ?? null;
  const targetAgentUserId = createdTarget?.agent.userId ?? existingTarget!.userId;
  if (!dry) {
    await waitForBlueprintProvisioning(projectRow.id, key, console.log);
    const job = await getProvisioningJob(projectRow.id);
    const completedAt = Date.parse(job?.completedAt ?? '');
    if (!Number.isFinite(completedAt)) {
      throw new Error(`Project ${key} has no completed provisioning timestamp`);
    }
    await waitForRunner(agent.id, key, completedAt);
  }
  const columns = await db
    .select({ id: projectColumn.id, name: projectColumn.name, type: projectColumn.stateType })
    .from(projectColumn)
    .where(eq(projectColumn.projectId, projectRow.id));
  const open =
    columns.find((item) => item.type === 'started') ??
    columns.find((item) => item.type === 'unstarted') ??
    columns[0];
  const done = columns.find((item) => item.type === 'completed');
  if (!open || !done) throw new Error('Default project states are incomplete');
  const [sequence] = await db
    .update(project)
    .set({ nextSequence: sql`${project.nextSequence} + 4` })
    .where(eq(project.id, projectRow.id))
    .returning({ nextSequence: project.nextSequence });
  const first = sequence!.nextSequence - 4;
  const seededIssues = await db
    .insert(issue)
    .values([
      {
        projectId: projectRow.id,
        sequenceNumber: first,
        columnId: open.id,
        title: 'Eval source A',
      },
      {
        projectId: projectRow.id,
        sequenceNumber: first + 1,
        columnId: open.id,
        title: 'Eval source B',
      },
      {
        projectId: projectRow.id,
        sequenceNumber: first + 2,
        columnId: open.id,
        title: 'Eval source C',
      },
      {
        projectId: projectRow.id,
        sequenceNumber: first + 3,
        columnId: open.id,
        title: 'Eval evidence',
      },
    ])
    .returning({ id: issue.id, sequence: issue.sequenceNumber });
  owned.issueIds = seededIssues.map((row) => row.id);
  const issueId = (n: number) => seededIssues.find((row) => row.sequence === first + n - 1)!.id;
  const [goal] = await db
    .insert(organizationGoal)
    .values({
      teamId: owner.teamId,
      projectId: projectRow.id,
      title: `Eval delivery ${owned.tag}`,
      status: 'active',
    })
    .returning({ id: organizationGoal.id });
  owned.goalId = goal!.id;
  const [createdCycle] = await db
    .insert(cycle)
    .values({
      projectId: projectRow.id,
      name: `Eval March ${owned.tag}`,
      startDate: '2027-03-01',
      endDate: '2027-03-31',
    })
    .returning({ id: cycle.id });
  owned.cycleId = createdCycle!.id;
  const [checklist] = await db
    .insert(issueChecklist)
    .values({ issueId: issueId(1), title: 'Eval base checklist' })
    .returning({ id: issueChecklist.id });
  const scheduleId = randomUUID();
  owned.scheduleId = scheduleId;
  await db.insert(helenaSchedule).values({
    id: scheduleId,
    projectId: projectRow.id,
    kind: 'routine',
    title: `Eval weekly ${owned.tag}`,
    cron: '0 9 * * 1',
    mode: 'new',
    agentId: agent.id,
    instructions: 'Fixture only',
    enabled: false,
    actorUserId: owner.ownerId,
    createdBy: owner.ownerId,
  });
  const [account] = await db
    .insert(mailAccount)
    .values({
      teamId: owner.teamId,
      projectId: projectRow.id,
      name: 'Eval mailbox',
      address: `${key.toLowerCase()}-${owned.tag}@eval.invalid`,
      imapHost: 'invalid.local',
      smtpHost: 'invalid.local',
      username: key,
      enabled: false,
    })
    .returning({ id: mailAccount.id });
  owned.mailAccountId = account!.id;
  const now = new Date();
  const [thread] = await db
    .insert(mailThread)
    .values({
      teamId: owner.teamId,
      accountId: account!.id,
      projectId: projectRow.id,
      threadKey: randomUUID(),
      subject: `Eval sample mail ${owned.tag}`,
      lastMessageAt: now,
    })
    .returning({ id: mailThread.id });
  const codes = {
    search: `SAF-${randomUUID().slice(0, 8)}`,
    file: `FIL-${randomUUID().slice(0, 8)}`,
    answer: `Orion-${randomUUID().slice(0, 6)}`,
    mail: `invoice REF-${randomUUID().slice(0, 6)}`,
    receipt: '84.17 EUR',
    decision: `approve-${randomUUID().slice(0, 6)}`,
  };
  await db.insert(mailMessage).values({
    teamId: owner.teamId,
    accountId: account!.id,
    threadId: thread!.id,
    messageId: `<${randomUUID()}@eval.invalid>`,
    subject: `Eval sample mail ${owned.tag}`,
    fromAddress: 'vendor@eval.invalid',
    sentAt: now,
    textBody: `Hello, please pay for the toolkit we delivered last week. Reference ${codes.mail.split(' ')[1]}. Thank you.`,
    rawKey: `eval/${key}/${owned.tag}/mail.eml`,
  });
  const [decision] = await db
    .insert(helenaDecision)
    .values({
      teamId: owner.teamId,
      projectId: projectRow.id,
      classId: 'eval-fixture',
      subject: `${key}:${owned.tag}`,
      questionId: 'sample',
      kind: 'choice',
      options: [codes.decision, 'reject'],
      choice: codes.decision,
      threshold: 0.8,
      status: 'decided',
      inputHash: randomUUID(),
    })
    .returning({ id: helenaDecision.id });
  owned.decisionId = decision!.id;
  const fixtureDirectory = `Projects/${key}/Docs/Eval-${owned.tag}`;
  owned.fixtureDirectory = fixtureDirectory;
  const vaultPaths = [
    `${fixtureDirectory}/Facts.md`,
    `${fixtureDirectory}/Readme.txt`,
    `${fixtureDirectory}/Receipt.txt`,
    `${fixtureDirectory}/Agent-result.md`,
  ];
  await writeVaultFile(
    vaultPaths[0]!,
    Buffer.from(
      `# Eval facts\nSaffron access code: ${codes.search}\nLaunch constellation: ${codes.answer}\n`,
    ),
    null,
  );
  await writeVaultFile(vaultPaths[1]!, Buffer.from(`Eval file code: ${codes.file}\n`), null);
  await writeVaultFile(
    vaultPaths[2]!,
    Buffer.from(`Example receipt\nIssuer: Eval Supplies\nGross: ${codes.receipt}\n`),
    null,
  );
  await indexVaultPaths(vaultPaths.slice(0, 3));
  const [receipt] = await db
    .insert(helenaReceipt)
    .values({
      teamId: owner.teamId,
      projectId: projectRow.id,
      source: 'vault',
      vaultPath: vaultPaths[2]!,
      filename: 'Receipt.txt',
      contentType: 'text/plain',
      sha256: randomUUID(),
      totalGross: '84.17',
      textExcerpt: `Gross: ${codes.receipt}`,
      extraction: 'text',
    })
    .returning({ id: helenaReceipt.id });
  owned.receiptId = receipt!.id;
  return {
    tag: owned.tag,
    projectId: projectRow.id,
    key,
    teamId: owner.teamId,
    agentId: agent.id,
    agentUserId: agent.userId,
    targetAgentUserId,
    targetUsername,
    columns: { open: open.id, done: done.id },
    issues: { a: issueId(1), b: issueId(2), c: issueId(3), evidence: issueId(4) },
    issueNumbers: { a: first, b: first + 1, c: first + 2, evidence: first + 3 },
    goalId: goal!.id,
    checklistId: checklist!.id,
    codes,
    vaultPaths,
  };
}

async function evidence(seed: Seed, body: string): Promise<void> {
  await db.insert(issueActivity).values({
    issueId: seed.issues.evidence,
    kind: 'comment',
    actorUserId: seed.agentUserId,
    body,
  });
}

async function fixture(seed: Seed, number: number): Promise<void> {
  const nextSequence = async () => {
    const [row] = await db
      .update(project)
      .set({ nextSequence: sql`${project.nextSequence} + 1` })
      .where(eq(project.id, seed.projectId))
      .returning({ nextSequence: project.nextSequence });
    return row!.nextSequence - 1;
  };
  switch (number) {
    case 1:
      await db.insert(issue).values({
        projectId: seed.projectId,
        sequenceNumber: await nextSequence(),
        columnId: seed.columns.open,
        title: `Eval intake ${seed.tag}`,
      });
      break;
    case 2:
      await db
        .update(issue)
        .set({ columnId: seed.columns.done })
        .where(eq(issue.id, seed.issues.b));
      break;
    case 3:
      await db.insert(issueActivity).values({
        issueId: seed.issues.a,
        kind: 'comment',
        actorUserId: seed.agentUserId,
        body: `Reviewed ${seed.key}`,
      });
      break;
    case 4:
      await db
        .update(issue)
        .set({ delegateUserId: seed.targetAgentUserId })
        .where(eq(issue.id, seed.issues.c));
      break;
    case 5:
      await db.insert(issue).values({
        projectId: seed.projectId,
        sequenceNumber: await nextSequence(),
        columnId: seed.columns.open,
        parentId: seed.issues.a,
        title: `Eval child ${seed.tag}`,
      });
      break;
    case 6:
      await evidence(seed, seed.codes.search);
      break;
    case 7:
      await evidence(seed, seed.codes.file);
      break;
    case 8:
      await writeVaultFile(seed.vaultPaths[3]!, Buffer.from(`Eval document ${seed.key}\n`), null);
      await indexVaultPaths([seed.vaultPaths[3]!]);
      break;
    case 9:
      await db.insert(helenaGoalTask).values({
        issueId: seed.issues.b,
        goalId: seed.goalId,
        teamId: seed.teamId,
        linkedByUserId: seed.agentUserId,
      });
      break;
    case 10:
      await evidence(seed, seed.codes.decision);
      break;
    case 11:
      await evidence(seed, '0 9 * * 1');
      break;
    case 12:
      await evidence(seed, seed.codes.answer);
      break;
    case 13:
      await evidence(seed, seed.codes.mail);
      break;
    case 14:
      await evidence(seed, seed.codes.receipt);
      break;
    case 15:
      await db.update(issue).set({ priority: 'high' }).where(eq(issue.id, seed.issues.a));
      break;
    case 16:
      await db.update(issue).set({ dueDate: '2027-03-17' }).where(eq(issue.id, seed.issues.c));
      break;
    case 17:
      await db
        .insert(issueChecklist)
        .values({ issueId: seed.issues.a, title: `Eval checks ${seed.tag}` });
      break;
    case 18:
      await db
        .insert(issueChecklistItem)
        .values({ checklistId: seed.checklistId, content: `Verify sample ${seed.key}` });
      break;
    case 19:
      await db
        .insert(initiative)
        .values({ projectId: seed.projectId, title: `Eval expansion ${seed.tag}` });
      break;
    case 20:
      await db
        .insert(issueLink)
        .values({ sourceIssueId: seed.issues.a, targetIssueId: seed.issues.c, kind: 'blocks' });
      break;
  }
}

async function check(seed: Seed, number: number): Promise<boolean> {
  const issueById = async (id: number) =>
    (await db.select().from(issue).where(eq(issue.id, id)))[0];
  const hasEvidence = async (body: string) =>
    (
      await db
        .select({ id: issueActivity.id })
        .from(issueActivity)
        .where(
          and(
            eq(issueActivity.issueId, seed.issues.evidence),
            eq(issueActivity.kind, 'comment'),
            eq(issueActivity.body, body),
          ),
        )
    ).length > 0;
  switch (number) {
    case 1:
      return (
        (
          await db
            .select()
            .from(issue)
            .where(
              and(eq(issue.projectId, seed.projectId), eq(issue.title, `Eval intake ${seed.tag}`)),
            )
        ).length === 1
      );
    case 2:
      return (await issueById(seed.issues.b))?.columnId === seed.columns.done;
    case 3:
      return (
        (
          await db
            .select()
            .from(issueActivity)
            .where(
              and(
                eq(issueActivity.issueId, seed.issues.a),
                eq(issueActivity.kind, 'comment'),
                eq(issueActivity.body, `Reviewed ${seed.key}`),
              ),
            )
        ).length > 0
      );
    case 4:
      return (await issueById(seed.issues.c))?.delegateUserId === seed.targetAgentUserId;
    case 5:
      return (
        (
          await db
            .select()
            .from(issue)
            .where(
              and(eq(issue.parentId, seed.issues.a), eq(issue.title, `Eval child ${seed.tag}`)),
            )
        ).length === 1
      );
    case 6:
      return hasEvidence(seed.codes.search);
    case 7:
      return hasEvidence(seed.codes.file);
    case 8:
      return (
        (
          await db
            .select()
            .from(vaultEntry)
            .where(
              and(
                eq(vaultEntry.path, seed.vaultPaths[3]!),
                eq(vaultEntry.text, `Eval document ${seed.key}\n`),
              ),
            )
        ).length > 0
      );
    case 9:
      return (
        (
          await db
            .select()
            .from(helenaGoalTask)
            .where(
              and(
                eq(helenaGoalTask.issueId, seed.issues.b),
                eq(helenaGoalTask.goalId, seed.goalId),
              ),
            )
        ).length === 1
      );
    case 10:
      return hasEvidence(seed.codes.decision);
    case 11:
      return hasEvidence('0 9 * * 1');
    case 12:
      return hasEvidence(seed.codes.answer);
    case 13:
      return hasEvidence(seed.codes.mail);
    case 14:
      return hasEvidence(seed.codes.receipt);
    case 15:
      return (await issueById(seed.issues.a))?.priority === 'high';
    case 16:
      return (await issueById(seed.issues.c))?.dueDate === '2027-03-17';
    case 17:
      return (
        (
          await db
            .select()
            .from(issueChecklist)
            .where(
              and(
                eq(issueChecklist.issueId, seed.issues.a),
                eq(issueChecklist.title, `Eval checks ${seed.tag}`),
              ),
            )
        ).length === 1
      );
    case 18:
      return (
        (
          await db
            .select()
            .from(issueChecklistItem)
            .where(
              and(
                eq(issueChecklistItem.checklistId, seed.checklistId),
                eq(issueChecklistItem.content, `Verify sample ${seed.key}`),
              ),
            )
        ).length === 1
      );
    case 19:
      return (
        (
          await db
            .select()
            .from(initiative)
            .where(
              and(
                eq(initiative.projectId, seed.projectId),
                eq(initiative.title, `Eval expansion ${seed.tag}`),
              ),
            )
        ).length === 1
      );
    case 20:
      return (
        (
          await db
            .select()
            .from(issueLink)
            .where(
              and(
                eq(issueLink.sourceIssueId, seed.issues.a),
                eq(issueLink.targetIssueId, seed.issues.c),
                eq(issueLink.kind, 'blocks'),
              ),
            )
        ).length === 1
      );
    default:
      return false;
  }
}

async function waitForRun(runId: number): Promise<typeof agentRun.$inferSelect> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const [row] = await db.select().from(agentRun).where(eq(agentRun.id, runId));
    if (!row) throw new Error(`Run ${runId} disappeared`);
    if (row.status !== 'pending') return row;
    await Bun.sleep(2000);
  }
  await db
    .update(agentRun)
    .set({ status: 'canceled', lastError: 'Eval timeout', finishedAt: new Date() })
    .where(and(eq(agentRun.id, runId), eq(agentRun.status, 'pending')));
  throw new Error(`Run ${runId} timed out after 10 minutes`);
}

async function runCase(seed: Seed, task: Case, model: string, dry: boolean): Promise<Row> {
  const started = Date.now();
  let runId: number | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let toolCalls = 0;
  let mcpToolCalls = 0;
  let error: string | null = null;
  try {
    if (dry) {
      if (await check(seed, task.number))
        throw new Error('Fixture check passed before applying the fixture');
      await fixture(seed, task.number);
    } else {
      runId = await db.transaction(async (tx) => {
        const id = await enqueueAgentRun(
          {
            agentId: seed.agentId,
            projectId: seed.projectId,
            issueId: null,
            sourceActivityId: null,
            trigger: 'workspace',
            prompt: `${task.prompt(seed)} Use Helena MCP for project data. Complete this one task only.`,
          },
          tx,
        );
        await tx
          .update(agentRun)
          .set({ model, maxTurns: 20, runBudgetSeconds: 540 })
          .where(eq(agentRun.id, id));
        return id;
      });
      const result = await waitForRun(runId);
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      const events = await db
        .select({ payload: agentRunEvent.payload })
        .from(agentRunEvent)
        .where(eq(agentRunEvent.runId, runId));
      const starts = events
        .map(({ payload }) => payload as { type?: unknown; toolCallName?: unknown })
        .filter((payload) => payload?.type === 'TOOL_CALL_START');
      toolCalls = starts.length;
      mcpToolCalls = starts.filter(
        (payload) =>
          typeof payload.toolCallName === 'string' &&
          /^(?:mcp__)?itsaplan__/.test(payload.toolCallName),
      ).length;
      const usedTools = starts
        .filter((payload) => typeof payload.toolCallName === 'string')
        .map((payload) => String(payload.toolCallName).split('__').at(-1));
      const modelCheck = result.modelCheck as {
        used?: { model?: string; provider?: string | null } | null;
        fallback?: unknown;
      } | null;
      if (result.status !== 'success') error = result.lastError ?? `Run status ${result.status}`;
      if (!error && modelCheck?.fallback) error = 'The runtime fell back from the requested model';
      if (!error && !modelCheck?.used?.model) error = 'Actual model was not reported';
      else if (!error && modelCheck?.used?.model && !sameModel(model, modelCheck.used.model))
        error = `Actual model: ${modelCheck.used.model}`;
      else if (
        !error &&
        model.startsWith('helena-local/') &&
        modelCheck?.used?.model &&
        !isLocalProvider(modelCheck.used.provider)
      )
        error = `Actual provider: ${modelCheck.used.provider ?? 'unknown'}`;
      if (!error && mcpToolCalls === 0)
        error =
          task.number === 10
            ? 'Decision log has no Helena MCP tool for project agents'
            : 'No Helena MCP call was recorded';
      const required = requiredMcpTools[task.number] ?? [];
      if (!error && required.length > 0 && !required.some((name) => usedTools.includes(name)))
        error = 'Required Helena MCP tool was not recorded';
    }
    const passed = await check(seed, task.number);
    if (!passed && !error)
      error =
        task.number === 10
          ? 'Decision log is not exposed to the project agent through Helena MCP'
          : 'Expected database state was absent';
    return {
      task: task.number,
      name: task.name,
      classId: task.classId,
      model,
      passed: passed && !error,
      durationMs: Date.now() - started,
      inputTokens,
      outputTokens,
      toolCalls,
      mcpToolCalls,
      error,
      runId,
    };
  } catch (caught) {
    return {
      task: task.number,
      name: task.name,
      classId: task.classId,
      model,
      passed: false,
      durationMs: Date.now() - started,
      inputTokens,
      outputTokens,
      toolCalls,
      mcpToolCalls,
      error: caught instanceof Error ? caught.message : String(caught),
      runId,
    };
  }
}

function suitability(rows: Row[], selected: Case[]) {
  const models = [
    ...new Set(rows.filter((row) => row.model.startsWith('helena-local/')).map((row) => row.model)),
  ];
  const classes = [...new Set(cases.map((item) => item.classId))];
  return {
    version: 1,
    models: Object.fromEntries(
      models.map((model) => [
        model,
        {
          classes: Object.fromEntries(
            classes.map((classId) => {
              const required = cases.filter((item) => item.classId === classId);
              const observed = rows.filter((row) => row.model === model && row.classId === classId);
              const comparison = rows.filter(
                (row) => row.model === 'gpt-6-luna' && row.classId === classId,
              );
              const complete =
                selected.length === cases.length && observed.length === required.length;
              const comparisonPassed =
                comparison.length === required.length && comparison.every((row) => row.passed);
              const localPassed = observed.every((row) => row.passed);
              return [
                classId,
                {
                  allowed: complete && comparisonPassed && localPassed,
                  tested: observed.length,
                  required: required.length,
                  reason: !complete
                    ? 'Incomplete local evaluation'
                    : !comparisonPassed
                      ? 'Missing or failed comparison evaluation'
                      : localPassed
                        ? null
                        : 'At least one local task failed',
                },
              ];
            }),
          ),
        },
      ]),
    ),
  };
}

function markdown(rows: Row[]): string {
  const head =
    '| Task | Model | Passed | Duration ms | Input tokens | Output tokens | Tool calls | Error |\n|---|---|---:|---:|---:|---:|---:|---|';
  return (
    [
      head,
      ...rows.map(
        (row) =>
          `| ${row.task}. ${row.name} | ${row.model} | ${row.passed ? 'yes' : 'no'} | ${row.durationMs} | ${row.inputTokens ?? '—'} | ${row.outputTokens ?? '—'} | ${row.toolCalls} | ${(row.error ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')} |`,
      ),
    ].join('\n') + '\n'
  );
}

async function cleanupOwned(owned: Owned, teamId: number, dry: boolean): Promise<void> {
  if (owned.projectId === null) return;
  let targetAgentId = owned.targetAgentId;
  if (targetAgentId === null && owned.targetUsername) {
    const [target] = await db
      .select({ id: aiAgent.id })
      .from(aiAgent)
      .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
      .where(
        and(
          eq(aiAgent.teamId, teamId),
          eq(aiAgent.username, owned.targetUsername),
          eq(projectMember.projectId, owned.projectId),
        ),
      );
    targetAgentId = target?.id ?? null;
  }
  if (owned.receiptId !== null)
    await db.delete(helenaReceipt).where(eq(helenaReceipt.id, owned.receiptId));
  if (owned.decisionId !== null)
    await db.delete(helenaDecision).where(eq(helenaDecision.id, owned.decisionId));
  if (owned.scheduleId !== null)
    await db.delete(helenaSchedule).where(eq(helenaSchedule.id, owned.scheduleId));
  if (owned.mailAccountId !== null)
    await db.delete(mailAccount).where(eq(mailAccount.id, owned.mailAccountId));
  if (owned.goalId !== null)
    await db.delete(organizationGoal).where(eq(organizationGoal.id, owned.goalId));
  if (owned.fixtureDirectory !== null) {
    await db
      .delete(vaultEntry)
      .where(
        sql`${vaultEntry.path} = ${owned.fixtureDirectory} OR ${vaultEntry.path} LIKE ${`${owned.fixtureDirectory}/%`}`,
      );
  }
  if (owned.createdProject) {
    if (targetAgentId !== null) await deleteAgent(targetAgentId, teamId);
    await deleteProject(owned.projectId);
    if (!dry) await waitForDeprovisioning(owned.projectId);
    else await rm(absoluteVaultPath(`Projects/${owned.key}`), { recursive: true, force: true });
    return;
  }
  await db
    .delete(issue)
    .where(
      and(
        eq(issue.projectId, owned.projectId),
        inArray(issue.title, [`Eval intake ${owned.tag}`, `Eval child ${owned.tag}`]),
      ),
    );
  await db
    .delete(initiative)
    .where(
      and(
        eq(initiative.projectId, owned.projectId),
        eq(initiative.title, `Eval expansion ${owned.tag}`),
      ),
    );
  if (owned.issueIds.length) await db.delete(issue).where(inArray(issue.id, owned.issueIds));
  if (owned.cycleId !== null) await db.delete(cycle).where(eq(cycle.id, owned.cycleId));
  if (owned.fixtureDirectory !== null) {
    await rm(absoluteVaultPath(owned.fixtureDirectory), { recursive: true, force: true });
  }
  if (targetAgentId !== null) {
    await deleteAgent(targetAgentId, teamId);
    if (!dry) await waitForBlueprintProvisioning(owned.projectId, owned.key, console.log);
  }
}

async function waitForDeprovisioning(projectId: number, timeoutMs = 300_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [job] = await db
      .select({
        status: projectDeprovisioningJob.status,
        lastError: projectDeprovisioningJob.lastError,
      })
      .from(projectDeprovisioningJob)
      .where(eq(projectDeprovisioningJob.projectId, projectId));
    if (job?.status === 'succeeded') return;
    if (job?.status === 'failed') {
      throw new Error(
        `Project ${projectId} isolation cleanup failed: ${job.lastError ?? 'unknown error'}`,
      );
    }
    await Bun.sleep(2000);
  }
  throw new Error(
    `Project ${projectId} isolation cleanup is still pending after ${timeoutMs / 1000}s`,
  );
}

async function main() {
  const dry = process.argv.includes('--dry');
  const keep = process.argv.includes('--keep');
  const only = option('only') === null ? null : Number(option('only'));
  const selectedModels = dry ? ['fixture'] : models();
  assertOptions(dry, only, selectedModels);
  const selected = cases.filter((item) => only === null || item.number === only);
  const rows: Row[] = [];
  const keptProjects: string[] = [];
  const projectKey = option('project-key');
  const existingAgentId = option('agent-id') === null ? null : Number(option('agent-id'));
  const existingProject = projectKey
    ? (
        await db
          .select({ id: project.id, teamId: project.teamId })
          .from(project)
          .where(eq(project.key, projectKey))
      )[0]
    : null;
  if (projectKey && !existingProject) throw new Error(`Project ${projectKey} was not found`);
  await db.transaction(async (lock) => {
    const [claimed] = await lock.execute(sql`select pg_try_advisory_xact_lock(432043) as acquired`);
    if (!(claimed as { acquired?: boolean } | undefined)?.acquired)
      throw new Error('Another Helena MCP eval is already running');
    const owner = await ownerForRun(dry, existingProject?.teamId);
    try {
      for (const model of selectedModels) {
        const key = projectKey ?? `EVAL${randomUUID().slice(0, 6).toUpperCase()}`;
        const owned: Owned = {
          key,
          projectId: null,
          createdProject: projectKey === null,
          targetAgentId: null,
          targetUsername: null,
          issueIds: [],
          goalId: null,
          cycleId: null,
          scheduleId: null,
          mailAccountId: null,
          decisionId: null,
          receiptId: null,
          fixtureDirectory: null,
          tag: randomUUID().slice(0, 8),
        };
        let seeded = false;
        try {
          const seed = await seedProject(key, owner, dry, existingAgentId, owned);
          seeded = true;
          if (keep) keptProjects.push(seed.key);
          for (const task of selected) {
            if (!dry) await waitForRunner(seed.agentId, seed.key, 0, 30_000);
            rows.push(await runCase(seed, task, model, dry));
          }
        } finally {
          if (!keep || !seeded) await cleanupOwned(owned, owner.teamId, dry);
        }
      }
    } finally {
      if (owner.temporary && (!keep || keptProjects.length === 0)) {
        await db.delete(team).where(eq(team.id, owner.teamId));
        await db.delete(user).where(eq(user.id, owner.ownerId));
      }
    }
  });
  const report = {
    version: 1,
    dry,
    models: selectedModels,
    tasks: selected.map(({ number, name, classId }) => ({ number, name, classId })),
    rows,
    localSuitability: suitability(rows, selected),
    keptProjects,
  };
  const output = option('output');
  if (output) {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(`${output}.json`, JSON.stringify(report, null, 2) + '\n');
    await writeFile(`${output}.md`, markdown(rows));
    await writeFile(
      `${output}.local-suitability.json`,
      JSON.stringify(report.localSuitability, null, 2) + '\n',
    );
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n${markdown(rows)}`);
  if (rows.some((row) => !row.passed)) process.exitCode = 1;
}

if (import.meta.main) {
  try {
    await main();
    process.exit(process.exitCode ?? 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
