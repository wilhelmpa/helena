// Run with the API service environment and an active project runner:
// bun apps/api/src/scripts/eval-helena-mcp.ts --model helena-local/Qwen3.6-35B-A3B-MTP-GGUF
//   --model gpt-6-luna --output /tmp/helena-mcp-eval
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
import { createProject, deleteProject } from '#modules/projects/service';
import { enqueueAgentRun } from '#modules/agents/core/run-queue';
import { sameModel } from '#modules/agents/runtime-sync/model-check';

type ClassId = 'tickets' | 'knowledge' | 'planning' | 'mail' | 'finance' | 'decisions';
type Case = { number: number; name: string; classId: ClassId; prompt: (seed: Seed) => string };
type Seed = {
  projectId: number;
  key: string;
  teamId: number;
  ownerId: string;
  agentId: number;
  agentUserId: string;
  targetAgentUserId: string;
  targetUsername: string;
  columns: { open: number; done: number };
  issues: { a: number; b: number; c: number; evidence: number };
  goalId: number;
  mailAccountId: number;
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

const cases: Case[] = [
  {
    number: 1,
    name: 'Create ticket',
    classId: 'tickets',
    prompt: (s) => `Create a ticket in ${s.key} titled "Eval intake ${s.key}".`,
  },
  {
    number: 2,
    name: 'Set status',
    classId: 'tickets',
    prompt: (s) => `Move ${s.key}-2 to the completed state.`,
  },
  {
    number: 3,
    name: 'Comment',
    classId: 'tickets',
    prompt: (s) => `Comment "Reviewed ${s.key}" on ${s.key}-1.`,
  },
  {
    number: 4,
    name: 'Delegate',
    classId: 'tickets',
    prompt: (s) => `Delegate ${s.key}-3 to @${s.targetUsername}.`,
  },
  {
    number: 5,
    name: 'Subtask',
    classId: 'tickets',
    prompt: (s) => `Create a subtask titled "Eval child ${s.key}" under ${s.key}-1.`,
  },
  {
    number: 6,
    name: 'Search knowledge',
    classId: 'knowledge',
    prompt: (s) =>
      `Search project ${s.key} knowledge for the saffron access code in the facts note. Comment only that code on ${s.key}-4.`,
  },
  {
    number: 7,
    name: 'Read file',
    classId: 'knowledge',
    prompt: (s) =>
      `Read Projects/${s.key}/Docs/Readme.txt and comment its file code on ${s.key}-4.`,
  },
  {
    number: 8,
    name: 'Write document',
    classId: 'knowledge',
    prompt: (s) =>
      `Write Projects/${s.key}/Docs/Agent-result.md with the line "Eval document ${s.key}".`,
  },
  {
    number: 9,
    name: 'Link goal',
    classId: 'planning',
    prompt: (s) => `Link ${s.key}-2 to the project goal "Eval delivery".`,
  },
  {
    number: 10,
    name: 'Read decision log',
    classId: 'decisions',
    prompt: (s) =>
      `Read the decision log entry for ${s.key}. Comment its choice on ${s.key}-4. If the log is inaccessible, say so.`,
  },
  {
    number: 11,
    name: 'List schedules',
    classId: 'planning',
    prompt: (s) =>
      `List the routines of ${s.key}. Comment the cron of the routine named "Eval weekly" on ${s.key}-4.`,
  },
  {
    number: 12,
    name: 'Answer from docs',
    classId: 'knowledge',
    prompt: (s) =>
      `According to the facts note of ${s.key}, what is the launch constellation? Comment only the answer on ${s.key}-4.`,
  },
  {
    number: 13,
    name: 'Classify mail',
    classId: 'mail',
    prompt: (s) =>
      `Read the sample mail in ${s.key}. Classify it as invoice, support request, or advertisement. Comment the category and its reference on ${s.key}-4. Do not send mail.`,
  },
  {
    number: 14,
    name: 'Recognize receipt',
    classId: 'finance',
    prompt: (s) =>
      `Read the sample receipt file in Projects/${s.key}/Docs/Receipt.txt. Comment the gross amount, including currency, on ${s.key}-4.`,
  },
  {
    number: 15,
    name: 'Set priority',
    classId: 'tickets',
    prompt: (s) => `Set priority of ${s.key}-1 to high.`,
  },
  {
    number: 16,
    name: 'Set due date',
    classId: 'tickets',
    prompt: (s) => `Set due date of ${s.key}-3 to 2027-03-17.`,
  },
  {
    number: 17,
    name: 'Create checklist',
    classId: 'tickets',
    prompt: (s) => `Create a checklist titled "Eval checks ${s.key}" on ${s.key}-1.`,
  },
  {
    number: 18,
    name: 'Add checklist item',
    classId: 'tickets',
    prompt: (s) =>
      `Add "Verify sample ${s.key}" to the existing "Eval base checklist" on ${s.key}-1.`,
  },
  {
    number: 19,
    name: 'Create initiative',
    classId: 'planning',
    prompt: (s) => `Create an initiative titled "Eval expansion ${s.key}" in ${s.key}.`,
  },
  {
    number: 20,
    name: 'Link tickets',
    classId: 'tickets',
    prompt: (s) => `Record that ${s.key}-1 blocks ${s.key}-3.`,
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
  if (selected !== null && (!Number.isInteger(selected) || selected < 1 || selected > 20)) {
    throw new Error('--only must be an integer from 1 to 20');
  }
  if (!dry && selectedModels.length === 0) throw new Error('Provide at least one --model');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!process.env.PROJECT_VAULT_ROOT) throw new Error('PROJECT_VAULT_ROOT is required');
  if (dry && !new URL(process.env.DATABASE_URL).pathname.match(/(?:_test|_eval)$/)) {
    throw new Error('--dry requires a database whose name ends in _test or _eval');
  }
}

async function ownerForRun(
  dry: boolean,
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
  const wanted = teamOption ? Number(teamOption) : homes.length === 1 ? homes[0]!.teamId : null;
  const owners = await db
    .select({ teamId: teamMember.teamId, ownerId: teamMember.userId })
    .from(teamMember)
    .where(and(eq(teamMember.role, 'owner'), wanted ? eq(teamMember.teamId, wanted) : undefined));
  if (owners.length === 1) {
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

async function seedProject(
  key: string,
  owner: {
    teamId: number;
    ownerId: string;
    temporary: boolean;
  },
): Promise<Seed> {
  const projectRow = await createProject(
    { key, name: 'EVAL', description: 'Disposable Helena MCP evaluation', locale: 'en' },
    owner.ownerId,
    owner.teamId,
  );
  await db
    .update(project)
    .set({ mcpEnabled: true, autopilotLevel: 3 })
    .where(eq(project.id, projectRow.id));
  const [agent] = await db
    .select({ id: aiAgent.id, userId: aiAgent.userId })
    .from(aiAgent)
    .where(
      and(
        eq(aiAgent.teamId, owner.teamId),
        eq(aiAgent.username, hermesProjectCoordinatorUsername(key)),
      ),
    )
    .orderBy(sql`${aiAgent.id} DESC`)
    .limit(1);
  if (!agent) throw new Error('Project coordinator was not created');
  await db
    .update(aiAgent)
    .set({ triggerOnAssign: false, triggerOnMention: false })
    .where(eq(aiAgent.id, agent.id));
  const targetAgentUserId = randomUUID();
  const targetUsername = `eval-target-${key.toLowerCase()}`;
  await db.insert(user).values({
    id: targetAgentUserId,
    name: 'Eval target',
    email: `${targetAgentUserId}@agents.local`,
    role: 'user',
  });
  await db.insert(aiAgent).values({
    teamId: owner.teamId,
    userId: targetAgentUserId,
    username: targetUsername,
    kind: 'external',
    triggerOnAssign: false,
    triggerOnMention: false,
  });
  await db
    .insert(teamMember)
    .values({ teamId: owner.teamId, userId: targetAgentUserId, role: 'agent' });
  await db
    .insert(projectMember)
    .values({ projectId: projectRow.id, userId: targetAgentUserId, role: 'member' });
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
  const seededIssues = await db
    .insert(issue)
    .values([
      { projectId: projectRow.id, sequenceNumber: 1, columnId: open.id, title: 'Eval source A' },
      { projectId: projectRow.id, sequenceNumber: 2, columnId: open.id, title: 'Eval source B' },
      { projectId: projectRow.id, sequenceNumber: 3, columnId: open.id, title: 'Eval source C' },
      { projectId: projectRow.id, sequenceNumber: 4, columnId: open.id, title: 'Eval evidence' },
    ])
    .returning({ id: issue.id, sequence: issue.sequenceNumber });
  await db.update(project).set({ nextSequence: 5 }).where(eq(project.id, projectRow.id));
  const issueId = (n: number) => seededIssues.find((row) => row.sequence === n)!.id;
  const [goal] = await db
    .insert(organizationGoal)
    .values({
      teamId: owner.teamId,
      projectId: projectRow.id,
      title: 'Eval delivery',
      status: 'active',
    })
    .returning({ id: organizationGoal.id });
  await db.insert(cycle).values({
    projectId: projectRow.id,
    name: 'Eval March',
    startDate: '2027-03-01',
    endDate: '2027-03-31',
  });
  const [checklist] = await db
    .insert(issueChecklist)
    .values({ issueId: issueId(1), title: 'Eval base checklist' })
    .returning({ id: issueChecklist.id });
  await db.insert(helenaSchedule).values({
    id: randomUUID(),
    projectId: projectRow.id,
    kind: 'routine',
    title: 'Eval weekly',
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
      address: `${key.toLowerCase()}@eval.invalid`,
      imapHost: 'invalid.local',
      smtpHost: 'invalid.local',
      username: key,
      enabled: false,
    })
    .returning({ id: mailAccount.id });
  const now = new Date();
  const [thread] = await db
    .insert(mailThread)
    .values({
      teamId: owner.teamId,
      accountId: account!.id,
      projectId: projectRow.id,
      threadKey: randomUUID(),
      subject: 'Eval sample mail',
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
    subject: 'Eval sample mail',
    fromAddress: 'vendor@eval.invalid',
    sentAt: now,
    textBody: `Hello, please pay for the toolkit we delivered last week. Reference ${codes.mail.split(' ')[1]}. Thank you.`,
    rawKey: `eval/${key}/mail.eml`,
  });
  await db.insert(helenaDecision).values({
    teamId: owner.teamId,
    projectId: projectRow.id,
    classId: 'eval-fixture',
    subject: key,
    questionId: 'sample',
    kind: 'choice',
    options: [codes.decision, 'reject'],
    choice: codes.decision,
    threshold: 0.8,
    status: 'decided',
    inputHash: randomUUID(),
  });
  const vaultPaths = [
    `Projects/${key}/Docs/Facts.md`,
    `Projects/${key}/Docs/Readme.txt`,
    `Projects/${key}/Docs/Receipt.txt`,
    `Projects/${key}/Docs/Agent-result.md`,
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
  await db.insert(helenaReceipt).values({
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
  });
  return {
    projectId: projectRow.id,
    key,
    teamId: owner.teamId,
    ownerId: owner.ownerId,
    agentId: agent.id,
    agentUserId: agent.userId,
    targetAgentUserId,
    targetUsername,
    columns: { open: open.id, done: done.id },
    issues: { a: issueId(1), b: issueId(2), c: issueId(3), evidence: issueId(4) },
    goalId: goal!.id,
    mailAccountId: account!.id,
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
  switch (number) {
    case 1:
      await db.insert(issue).values({
        projectId: seed.projectId,
        sequenceNumber: 5,
        columnId: seed.columns.open,
        title: `Eval intake ${seed.key}`,
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
        sequenceNumber: 6,
        columnId: seed.columns.open,
        parentId: seed.issues.a,
        title: `Eval child ${seed.key}`,
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
        .values({ issueId: seed.issues.a, title: `Eval checks ${seed.key}` });
      break;
    case 18:
      await db
        .insert(issueChecklistItem)
        .values({ checklistId: seed.checklistId, content: `Verify sample ${seed.key}` });
      break;
    case 19:
      await db
        .insert(initiative)
        .values({ projectId: seed.projectId, title: `Eval expansion ${seed.key}` });
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
              and(eq(issue.projectId, seed.projectId), eq(issue.title, `Eval intake ${seed.key}`)),
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
              and(eq(issue.parentId, seed.issues.a), eq(issue.title, `Eval child ${seed.key}`)),
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
                eq(issueChecklist.title, `Eval checks ${seed.key}`),
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
                eq(initiative.title, `Eval expansion ${seed.key}`),
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
      runId = await enqueueAgentRun({
        agentId: seed.agentId,
        projectId: seed.projectId,
        issueId: null,
        sourceActivityId: null,
        trigger: 'workspace',
        prompt: `${task.prompt(seed)} Use Helena MCP for project data. Complete this one task only.`,
        model,
        maxTurns: 20,
        runBudgetSeconds: 540,
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

async function cleanup(seed: Seed, dry: boolean): Promise<void> {
  await db.delete(mailAccount).where(eq(mailAccount.id, seed.mailAccountId));
  await db.delete(organizationGoal).where(eq(organizationGoal.id, seed.goalId));
  if (dry) {
    await db.delete(project).where(eq(project.id, seed.projectId));
    await db.delete(user).where(eq(user.id, seed.agentUserId));
  } else {
    await deleteProject(seed.projectId);
  }
  await db.delete(user).where(eq(user.id, seed.targetAgentUserId));
  await db
    .delete(vaultEntry)
    .where(
      sql`${vaultEntry.path} = ${`Projects/${seed.key}`} OR ${vaultEntry.path} LIKE ${`Projects/${seed.key}/%`}`,
    );
  await rm(absoluteVaultPath(`Projects/${seed.key}`), { recursive: true, force: true });
}

async function cleanupPartial(key: string, dry: boolean): Promise<void> {
  const [row] = await db.select({ id: project.id }).from(project).where(eq(project.key, key));
  if (row) {
    await db.delete(organizationGoal).where(eq(organizationGoal.projectId, row.id));
    await db
      .delete(mailAccount)
      .where(eq(mailAccount.address, `${key.toLowerCase()}@eval.invalid`));
    if (dry) await db.delete(project).where(eq(project.id, row.id));
    else await deleteProject(row.id);
  }
  const agents = await db
    .select({ userId: aiAgent.userId })
    .from(aiAgent)
    .where(
      inArray(aiAgent.username, [
        hermesProjectCoordinatorUsername(key),
        `eval-target-${key.toLowerCase()}`,
      ]),
    );
  for (const agent of agents) await db.delete(user).where(eq(user.id, agent.userId));
  await db
    .delete(vaultEntry)
    .where(
      sql`${vaultEntry.path} = ${`Projects/${key}`} OR ${vaultEntry.path} LIKE ${`Projects/${key}/%`}`,
    );
  await rm(absoluteVaultPath(`Projects/${key}`), { recursive: true, force: true });
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
  await db.transaction(async (lock) => {
    const [claimed] = await lock.execute(sql`select pg_try_advisory_xact_lock(432043) as acquired`);
    if (!(claimed as { acquired?: boolean } | undefined)?.acquired)
      throw new Error('Another Helena MCP eval is already running');
    const owner = await ownerForRun(dry);
    try {
      for (const model of selectedModels) {
        const key = `EVAL${randomUUID().slice(0, 6).toUpperCase()}`;
        let seed: Seed | null = null;
        try {
          seed = await seedProject(key, owner);
          if (keep) keptProjects.push(seed.key);
          for (const task of selected) rows.push(await runCase(seed, task, model, dry));
        } finally {
          if (!keep) {
            if (seed) await cleanup(seed, dry);
            else await cleanupPartial(key, dry);
          }
        }
      }
    } finally {
      if (owner.temporary && !keep) {
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
