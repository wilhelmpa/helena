import { expect } from 'bun:test';
import { app, authedApi } from '#tests/helpers/app';
import { createAgent } from '#tests/helpers/agents';
import { signUpTestUser } from '#tests/helpers/auth';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';
import { db, helenaReceipt } from '@repo/db';
import { auth } from '@repo/auth';
import { resetDb } from '#tests/helpers/db';

let sequence = 0;

export async function seedToolStack() {
  await resetDb();
  const owner = await signUpTestUser({ name: 'ABSCHLUSSTEST Owner' });
  const outsider = await signUpTestUser({ name: 'ABSCHLUSSTEST Outsider' });
  const api = authedApi(owner.cookie);
  const key = `ABSCHLUSSTEST${++sequence}`;
  const project = (await api.projects.post({ key, name: 'ABSCHLUSSTEST Project' })).data!;
  const foreign = (
    await authedApi(outsider.cookie).projects.post({
      key: `FOREIGN${sequence}`,
      name: 'ABSCHLUSSTEST Foreign',
    })
  ).data!;
  const detail = (await api.projects({ projectKey: key }).get()).data!;
  const agentResponse = await createAgent(api, key, {
    name: 'ABSCHLUSSTEST Agent',
    username: `abschlusstest${sequence}`,
    triggerOnAssign: true,
  });
  expect(agentResponse.status).toBe(201);
  const agent = agentResponse.data!.agent;
  const { key: agentKey } = await auth.api.createApiKey({
    body: { userId: agent.userId, name: 'ABSCHLUSSTEST' },
  });
  const restricted = (
    await api.projects.post({
      key: `OTHER${sequence}`,
      name: 'ABSCHLUSSTEST Other project in same team',
    })
  ).data!;
  const restrictedDetail = (await api.projects({ projectKey: restricted.key }).get()).data!;
  const restrictedIssue = (
    await api.projects({ projectKey: restricted.key }).issues.post({
      title: 'ABSCHLUSSTEST Foreign task',
      columnId: restrictedDetail.columns[0]!.id,
    })
  ).data!;
  const issueResponse = await api
    .projects({ projectKey: key })
    .issues.post({ title: 'ABSCHLUSSTEST Task', columnId: detail.columns[0]!.id });
  expect(issueResponse.status).toBe(201);
  const issue = issueResponse.data!;
  const mail = await insertMailAccount(project.teamId, project.id, 'ABSCHLUSSTEST@example.test');
  const message = await insertMessage({
    teamId: project.teamId,
    projectId: project.id,
    projectKey: key,
    accountId: mail.accountId,
    folderId: mail.inboxId,
    subject: 'ABSCHLUSSTEST Thread',
    text: 'ABSCHLUSSTEST',
    fromName: 'ABSCHLUSSTEST',
  });
  const path = `Projects/${key}/Docs/ABSCHLUSSTEST.md`;
  const note = await app.handle(
    new Request('http://localhost/knowledge/notes', {
      method: 'PUT',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ path, content: '# ABSCHLUSSTEST' }),
    }),
  );
  expect(note.status).toBeLessThan(400);
  // Receipts normally enter through the worker's intake, which has no JSON create route.
  const [receipt] = await db
    .insert(helenaReceipt)
    .values({
      teamId: project.teamId,
      projectId: project.id,
      source: 'vault',
      vaultPath: path,
      filename: 'ABSCHLUSSTEST.md',
      contentType: 'text/markdown',
      sha256: 'a'.repeat(64),
      issuer: 'ABSCHLUSSTEST',
      invoiceNumber: 'ABSCHLUSSTEST',
      totalGross: '1.00',
    })
    .returning();
  const goalResponse = await api
    .teams({ teamId: project.teamId })
    .organization.goals.post({ title: 'ABSCHLUSSTEST Goal', projectId: project.id });
  expect(goalResponse.status).toBe(201);
  const routineResponse = await api.projects({ projectKey: key }).routines.post({
    idempotencyKey: crypto.randomUUID(),
    agentId: agent.id,
    title: 'ABSCHLUSSTEST Routine',
    instructions: 'ABSCHLUSSTEST',
    mode: 'new',
    cron: '0 9 * * 1',
  });
  expect(routineResponse.status).toBe(201);
  return {
    owner,
    outsider,
    project,
    foreign,
    agent,
    agentKey,
    issue,
    path,
    restrictedFields: {
      projectKey: restricted.key,
      projectId: restricted.id,
      issueId: restrictedIssue.id,
      columnId: restrictedDetail.columns[0]!.id,
      path: `Projects/${restricted.key}/Docs/ABSCHLUSSTEST.md`,
      root: `Projects/${restricted.key}`,
    },
    fields: {
      projectKey: key,
      projectId: project.id,
      teamId: project.teamId,
      agentId: agent.id,
      userId: owner.userId,
      columnId: detail.columns[0]!.id,
      issueId: issue.id,
      threadId: message.threadId,
      messageId: message.messageRowId,
      accountId: mail.accountId,
      receiptId: receipt!.id,
      goalId: goalResponse.data!.id,
      routineId: routineResponse.data!.id,
      path,
      root: `Projects/${key}`,
      folder: `Projects/${key}/Docs`,
      name: 'ABSCHLUSSTEST',
      title: 'ABSCHLUSSTEST',
      username: `newabschlusstest${sequence}`,
      key: `NEW${sequence}`,
      email: 'ABSCHLUSSTEST@example.test',
      body: 'ABSCHLUSSTEST',
      content: 'ABSCHLUSSTEST',
    },
  };
}
