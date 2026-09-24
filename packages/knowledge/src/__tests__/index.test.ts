import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import {
  agentChatMessage,
  agentChatThread,
  agentRun,
  aiAgent,
  appSetting,
  db,
  issue,
  issueActivity,
  mailAccount,
  mailMessage,
  mailThread,
  project,
  projectColumn,
  team,
  teamMember,
  user,
} from '@repo/db';
import { indexVaultPaths } from '@repo/vault';
import { ANY_RESOURCE, emptyReach, type KnowledgeReach } from '../reach';
import { builtinKnowledgeSources } from '../sources';
import { runSources, reindexItems } from '../indexer';
import { linkingItems, readIndexedItem, searchKnowledgeIndex } from '../search';
import { issueSource } from '../sources/issues';
import { captureToInbox, captureToJournal, appendUnderInbox } from '../capture';
import { expandTemplate, formatDate, listTemplates, seedTemplates } from '../templates';

let root = '';
let suffix = '';
let ids: {
  teamId: number;
  ownerId: string;
  memberId: string;
  outsiderId: string;
  agentUserId: string;
  agentId: number;
  alpha: { id: number; key: string };
  beta: { id: number; key: string };
};

const rand = () => Math.random().toString(36).slice(2, 8);

async function put(relative: string, content: string) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), content);
}

async function makeUser(name: string, role = 'user') {
  const id = `u-${name}-${suffix}`;
  await db.insert(user).values({ id, name, email: `${id}@test.local`, role });
  return id;
}

async function makeProject(teamId: number, key: string) {
  const [row] = await db
    .insert(project)
    .values({ teamId, key, name: key })
    .returning({ id: project.id });
  const [column] = await db
    .insert(projectColumn)
    .values({ projectId: row!.id, name: 'Offen', position: 0 })
    .returning({ id: projectColumn.id });
  return { id: row!.id, key, columnId: column!.id };
}

beforeEach(async () => {
  const database = (process.env.DATABASE_URL ?? '').split('/').pop() ?? '';
  if (!database.includes('test')) throw new Error('refusing to run against a non-test database');
  await db.execute(
    sql`TRUNCATE knowledge_item, knowledge_link, knowledge_source_state, knowledge_chunk, vault_entry, vault_link, vault_move RESTART IDENTITY CASCADE`,
  );
  await db.delete(appSetting).where(eq(appSetting.key, 'knowledge.templatesSeeded'));
  root = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'knowledge-'));
  process.env.PROJECT_VAULT_ROOT = root;
  suffix = rand();
  // The instance owner of this test: the oldest god user of the database decides Home's
  // team, so the test works with its own reach instead.
  const ownerId = await makeUser('owner', 'god');
  const memberId = await makeUser('member');
  const outsiderId = await makeUser('outsider');
  const agentUserId = await makeUser('agent');
  const [t] = await db
    .insert(team)
    .values({ name: `T ${suffix}` })
    .returning({ id: team.id });
  const teamId = t!.id;
  await db.insert(teamMember).values([
    { teamId, userId: ownerId, role: 'owner' },
    { teamId, userId: memberId, role: 'member' },
    { teamId, userId: agentUserId, role: 'agent' },
  ]);
  const alpha = await makeProject(teamId, `A${suffix.toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`);
  const beta = await makeProject(teamId, `B${suffix.toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`);
  const [agent] = await db
    .insert(aiAgent)
    .values({ teamId, userId: agentUserId, username: `agent${suffix}`, kind: 'external' })
    .returning({ id: aiAgent.id });

  await db.insert(issue).values([
    {
      projectId: alpha.id,
      sequenceNumber: 1,
      columnId: alpha.columnId,
      title: 'Angebot für Kühlregale prüfen',
      description: 'Die Kühlregale sollen bis Freitag verglichen werden.',
    },
    {
      projectId: beta.id,
      sequenceNumber: 1,
      columnId: beta.columnId,
      title: 'Geheime Umstrukturierung',
      description: 'Nur für Beta sichtbar: Kühlregale werden verlegt.',
    },
  ]);
  const [alphaIssue] = await db
    .select({ id: issue.id })
    .from(issue)
    .where(eq(issue.projectId, alpha.id));
  await db.insert(issueActivity).values({
    issueId: alphaIssue!.id,
    kind: 'comment',
    actorUserId: agentUserId,
    actorName: 'agent',
    body: `Ich habe drei Händler für Kühlregale gefunden, siehe auch ${beta.key}-1.`,
  });

  const [account] = await db
    .insert(mailAccount)
    .values({
      teamId,
      name: 'Post',
      address: `post-${suffix}@test.local`,
      imapHost: 'imap.test',
      smtpHost: 'smtp.test',
      username: 'post',
    })
    .returning({ id: mailAccount.id });
  const [thread] = await db
    .insert(mailThread)
    .values({
      teamId,
      accountId: account!.id,
      projectId: alpha.id,
      threadKey: `k-${suffix}`,
      subject: 'Lieferung Kühlregale',
      lastMessageAt: new Date(),
    })
    .returning({ id: mailThread.id });
  await db.insert(mailMessage).values({
    teamId,
    accountId: account!.id,
    threadId: thread!.id,
    messageId: `<m-${suffix}@test>`,
    subject: 'Lieferung Kühlregale',
    fromName: 'Lieferant',
    fromAddress: 'lieferant@example.com',
    sentAt: new Date(),
    textBody: 'Die Kühlregale kommen am Dienstag.',
    rawKey: `raw/${suffix}`,
  });

  const threadId = `chat-${suffix}`;
  await db.insert(agentChatThread).values({
    id: threadId,
    agentId: agent!.id,
    userId: memberId,
    projectId: alpha.id,
    title: 'Planung',
  });
  await db.insert(agentChatMessage).values([
    {
      threadId,
      agentId: agent!.id,
      role: 'user',
      content: 'Welche Kühlregale passen?',
      status: 'success',
    },
    {
      threadId,
      agentId: agent!.id,
      role: 'assistant',
      content: 'Die Kühlregale von Händler B passen am besten.',
      status: 'success',
    },
  ]);
  await db.insert(agentRun).values({
    agentId: agent!.id,
    projectId: alpha.id,
    issueId: alphaIssue!.id,
    prompt: 'Vergleiche die Kühlregale',
    output: 'Händler B ist am günstigsten.',
    status: 'success',
  });

  await put(
    `Projects/${alpha.key}/Docs/Regale.md`,
    `---\ntags: [einkauf]\n---\nNotizen zu Kühlregalen, siehe [[${alpha.key}-1]].\n`,
  );
  await put(`Projects/${beta.key}/Docs/Beta.md`, 'Kühlregale im Beta-Lager.\n');
  await put('Private/Tagebuch.md', 'Privat: Kühlregale nerven.\n');
  await put('Templates/Meeting.md', '# {{title}}\n');
  await indexVaultPaths(['Projects', 'Private', 'Templates']);

  ids = { teamId, ownerId, memberId, outsiderId, agentUserId, agentId: agent!.id, alpha, beta };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// The member reads work items, documents, mail and agents in alpha only; the owner runs
// the team.
function memberReach(): KnowledgeReach {
  return {
    userId: ids.memberId,
    projects: new Map([[ids.alpha.id, new Set(['work_items', 'documents', 'mail', 'ai_agents'])]]),
    teams: new Map([[ids.teamId, new Set<string>()]]),
  };
}

function ownerReach(): KnowledgeReach {
  return {
    userId: ids.ownerId,
    projects: new Map([
      [ids.alpha.id, new Set([ANY_RESOURCE])],
      [ids.beta.id, new Set([ANY_RESOURCE])],
    ]),
    teams: new Map([[ids.teamId, new Set([ANY_RESOURCE])]]),
  };
}

const sources = () => builtinKnowledgeSources();

describe('knowledge index', () => {
  it('indexes every built-in source and finds them with one search', async () => {
    const results = await runSources(sources());
    expect(results.every((result) => result.error === null)).toBe(true);
    const found = await searchKnowledgeIndex(memberReach(), { q: 'Kühlregale', limit: 20 });
    const kinds = new Set(found.items.map((hit) => hit.source));
    expect(kinds).toEqual(new Set(['issue', 'vault', 'mail', 'chat', 'run']));
    // The comment shares its task's group, so the task shows once.
    expect(
      found.items.filter(
        (hit) =>
          ['issue', 'comment'].includes(hit.source) &&
          hit.metadata.identifier === `${ids.alpha.key}-1`,
      ).length,
    ).toBe(1);
    expect(found.counts.comment).toBe(1);
    const task = found.items.find((hit) => hit.source === 'issue')!;
    expect(task.href).toBe(`/project/${ids.alpha.key}/issue/1`);
    expect(task.snippet).toContain('**');
  });

  it('never shows what the reader could not open', async () => {
    await runSources(sources());
    const member = await searchKnowledgeIndex(memberReach(), {
      q: 'Kühlregale',
      limit: 50,
      collapse: false,
    });
    const paths = member.items.map((hit) => hit.ref);
    expect(paths).not.toContain(`vault:Projects/${ids.beta.key}/Docs/Beta.md`);
    expect(paths).not.toContain('vault:Private/Tagebuch.md');
    expect(member.items.some((hit) => hit.title === 'Geheime Umstrukturierung')).toBe(false);

    // Someone without any reach sees nothing, not even the chat of another member.
    const outsider = await searchKnowledgeIndex(emptyReach(ids.outsiderId), {
      q: 'Kühlregale',
      limit: 50,
    });
    expect(outsider.items).toEqual([]);

    // A chat is its member's own: the owner does not see the member's chat.
    const owner = await searchKnowledgeIndex(ownerReach(), {
      q: 'Kühlregale',
      limit: 50,
      collapse: false,
    });
    expect(owner.items.some((hit) => hit.source === 'chat')).toBe(false);
    expect(owner.items.some((hit) => hit.title === 'Geheime Umstrukturierung')).toBe(true);

    // A reader without the mail permission does not find the mail.
    const noMail: KnowledgeReach = {
      ...memberReach(),
      projects: new Map([[ids.alpha.id, new Set(['work_items'])]]),
    };
    const withoutMail = await searchKnowledgeIndex(noMail, { q: 'Dienstag', limit: 10 });
    expect(withoutMail.items).toEqual([]);
  });

  it('filters by source, project and vault folder', async () => {
    await runSources(sources());
    const onlyMail = await searchKnowledgeIndex(memberReach(), {
      q: 'Kühlregale',
      sources: ['mail'],
      limit: 10,
    });
    expect(onlyMail.items.map((hit) => hit.source)).toEqual(['mail']);
    expect(onlyMail.counts.issue).toBeGreaterThan(0);
    const folder = await searchKnowledgeIndex(ownerReach(), {
      q: 'Kühlregale',
      folder: `Projects/${ids.beta.key}`,
      limit: 10,
    });
    expect(folder.items.map((hit) => hit.ref)).toEqual([
      `vault:Projects/${ids.beta.key}/Docs/Beta.md`,
    ]);
    const byProject = await searchKnowledgeIndex(ownerReach(), {
      q: 'Kühlregale',
      projectId: ids.beta.id,
      limit: 10,
    });
    expect(new Set(byProject.items.map((hit) => hit.projectId))).toEqual(new Set([ids.beta.id]));
  });

  it('puts a task first when its identifier is the query', async () => {
    await runSources(sources());
    const found = await searchKnowledgeIndex(memberReach(), { q: `${ids.alpha.key}-1`, limit: 5 });
    expect(found.items[0]?.source).toBe('issue');
  });

  it('keeps provenance and backlinks across sources', async () => {
    await runSources(sources());
    const comment = await readIndexedItem(
      'comment',
      (
        await searchKnowledgeIndex(ownerReach(), {
          q: 'Händler gefunden',
          sources: ['comment'],
          limit: 1,
        })
      ).items[0]!.id,
    );
    expect(comment?.author).toBe(`agent:${ids.agentId}`);
    const run = (await searchKnowledgeIndex(memberReach(), { q: 'günstigsten', limit: 1 }))
      .items[0]!;
    expect(run.runId).toBe(Number(run.id));
    // The note and the run link to alpha's task; the comment mentions beta's.
    const toAlpha = await linkingItems(ownerReach(), [`task:${ids.alpha.key}-1`]);
    expect(new Set(toAlpha.map((item) => item.source))).toEqual(new Set(['vault', 'run']));
    const toBeta = await linkingItems(memberReach(), [`task:${ids.beta.key}-1`]);
    expect(toBeta.map((item) => item.source)).toEqual(['comment']);
  });

  it('catches up with changes and drops deleted items', async () => {
    await runSources(sources());
    await db
      .update(issue)
      .set({ title: 'Angebot für Tiefkühltruhen prüfen', updatedAt: new Date() })
      .where(eq(issue.projectId, ids.alpha.id));
    await db.delete(issueActivity).where(eq(issueActivity.actorUserId, ids.agentUserId));
    await db
      .update(agentChatThread)
      .set({ deletedAt: new Date() })
      .where(eq(agentChatThread.userId, ids.memberId));
    const results = await runSources(sources(), { sweepEveryMs: 0 });
    expect(results.find((result) => result.source === 'issue')?.written).toBeGreaterThanOrEqual(1);
    expect(results.find((result) => result.source === 'comment')?.removed).toBe(1);
    expect(results.find((result) => result.source === 'chat')?.removed).toBe(2);
    const found = await searchKnowledgeIndex(memberReach(), { q: 'Tiefkühltruhen', limit: 5 });
    expect(found.items[0]?.source).toBe('issue');
    // A second run with nothing changed writes nothing.
    const again = await runSources(sources());
    expect(again.every((result) => result.written === 0)).toBe(true);
  });

  it('reindexes named items right away', async () => {
    await runSources(sources());
    const [row] = await db
      .select({ id: issue.id })
      .from(issue)
      .where(eq(issue.projectId, ids.beta.id));
    await db.delete(issue).where(eq(issue.id, row!.id));
    await reindexItems(issueSource, [String(row!.id)]);
    expect(await readIndexedItem('issue', String(row!.id))).toBeNull();
  });
});

describe('capture, templates and daily notes', () => {
  it('seeds the templates and Obsidian settings once', async () => {
    await rm(path.join(root, 'Templates'), { recursive: true, force: true });
    const written = await seedTemplates('de');
    expect(written).toContain('Templates/Tagesnotiz.md');
    expect(written).toContain('.obsidian/daily-notes.json');
    const daily = JSON.parse(await readFile(path.join(root, '.obsidian/daily-notes.json'), 'utf8'));
    expect(daily).toEqual({
      folder: 'Home/Docs/Journal',
      format: 'YYYY-MM-DD',
      template: 'Templates/Tagesnotiz',
    });
    expect((await listTemplates()).map((template) => template.name)).toContain('Projektbrief');
    await rm(path.join(root, 'Templates/Meeting.md'));
    expect(await seedTemplates('de')).toEqual([]);
  });

  it('expands Obsidian template variables', () => {
    const date = new Date('2026-09-24T08:05:00Z');
    expect(formatDate(date, 'dddd, D. MMMM YYYY', 'de', 'Europe/Berlin')).toBe(
      'Donnerstag, 24. September 2026',
    );
    expect(
      expandTemplate('# {{title}} {{date}} {{time}} {{date:YY/MM}}', {
        title: 'Plan',
        date,
        timeZone: 'Europe/Berlin',
      }),
    ).toBe('# Plan 2026-09-24 10:05 26/09');
  });

  it('captures into the project inbox with its source', async () => {
    const result = await captureToInbox(
      {
        kind: 'web-page',
        title: 'Kühlregal Test: Vergleich',
        text: 'Ein Artikel.',
        origin: 'https://example.com/regale',
        teamId: ids.teamId,
        projectId: ids.alpha.id,
      },
      { ref: `agent:${ids.agentId}`, runId: 7, timeZone: 'Europe/Berlin' },
    );
    expect(result.item).toMatch(
      new RegExp(
        `^vault:Projects/${ids.alpha.key}/Inbox/\\d{4}-\\d\\d-\\d\\d Kühlregal Test Vergleich\\.md$`,
      ),
    );
    const text = await readFile(path.join(root, result.item.slice('vault:'.length)), 'utf8');
    expect(text).toContain('source: https://example.com/regale');
    await runSources(sources());
    const item = await readIndexedItem('vault', result.item.slice('vault:'.length));
    expect(item?.author).toBe(`agent:${ids.agentId}`);
    expect(item?.runId).toBe(7);
    expect(item?.origin).toBe('https://example.com/regale');
  });

  it('appends quick captures under the daily note inbox', async () => {
    await seedTemplates('de');
    const actor = { ref: `user:${ids.ownerId}`, timeZone: 'Europe/Berlin' };
    const first = await captureToJournal(
      {
        kind: 'text',
        title: 'Idee: Regale mieten',
        text: 'Idee: Regale mieten',
        teamId: ids.teamId,
        projectId: null,
      },
      actor,
    );
    await captureToJournal(
      {
        kind: 'text',
        title: 'Zweiter Gedanke',
        text: 'Zweiter Gedanke',
        teamId: ids.teamId,
        projectId: null,
      },
      actor,
    );
    const note = await readFile(path.join(root, first.item.slice('vault:'.length)), 'utf8');
    expect(first.item).toMatch(/^vault:Home\/Docs\/Journal\/\d{4}-\d\d-\d\d\.md$/);
    const inbox = note.slice(note.indexOf('## Eingang'), note.indexOf('## Rückblick'));
    expect(inbox).toMatch(/- \d\d:\d\d Idee: Regale mieten\n- \d\d:\d\d Zweiter Gedanke/);
  });

  it('appends at the end of a note without an inbox heading', () => {
    expect(appendUnderInbox('---\na: 1\n---\n# Tag\n\nText\n\n', '- x')).toBe(
      '---\na: 1\n---\n# Tag\n\nText\n\n- x\n',
    );
    expect(appendUnderInbox('# Tag\n## Eingang\n- a\n\n## Später\n', '- b')).toBe(
      '# Tag\n## Eingang\n- a\n- b\n\n## Später\n',
    );
  });
});
