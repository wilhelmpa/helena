import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, vaultEntry } from '@repo/db';
import { indexVaultPaths } from '@repo/vault';
import { knowledgeSources, runSources, seedTemplates } from '@helena/knowledge';
import { app, authedApi, type Api } from '#tests/helpers/app';
import { createAgent } from '#tests/helpers/agents';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// The second brain through the API: one search over every source, reading any item,
// capture, the daily note, templates, provenance of agent writes, and the round trip of
// a note between an outside editor (Obsidian) and Helena's Docs.

const root = () => process.env.PROJECT_VAULT_ROOT!;
const hasGit = Bun.which('git') !== null;

async function git(...args: string[]) {
  const child = Bun.spawn(['git', '-C', root(), ...args], { stdout: 'pipe', stderr: 'pipe' });
  await child.exited;
  return new Response(child.stdout).text();
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
  const issue = (
    await asOwner
      .projects({ projectKey: 'MKT' })
      .issues.post({ columnId: view.columns[0].id, title: 'Kühlregale bestellen' })
  ).data!;
  return { owner, asOwner, issue, view };
}

async function note(api: Api, notePath: string, content: string, expectedSha?: string) {
  return api.knowledge.notes.put({ path: notePath, content, expectedSha });
}

async function mcp(apiKey: string, method: string, params: Record<string, unknown> = {}) {
  const res = await app.handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  const text = await res.text();
  return JSON.parse(text.slice(text.indexOf('data: ') + 6)).result;
}

describe('second brain', () => {
  beforeEach(async () => {
    await resetDb();
    await rm(root(), { recursive: true, force: true });
    await mkdir(root(), { recursive: true });
  });

  it('finds tasks, comments and notes with one search and reads any hit', async () => {
    const { asOwner, issue } = await setup();
    await asOwner
      .issues({ issueId: issue.id })
      .comments.post({ body: 'Die Kühlregale kommen aus Hamburg.' });
    await note(asOwner, 'Projects/MKT/Docs/Regale.md', 'Vergleich der Kühlregale für [[MKT-1]].');
    await runSources(knowledgeSources());

    const found = await asOwner.knowledge.find.get({ query: { q: 'Kühlregale' } });
    expect(found.status).toBe(200);
    const sources = found.data!.items.map((hit) => hit.source);
    expect(sources).toContain('issue');
    expect(sources).toContain('vault');
    // The comment is in the task's group: the task shows once.
    expect(sources.filter((source) => source === 'comment' || source === 'issue')).toHaveLength(1);
    expect(found.data!.counts).toMatchObject({ issue: 1, comment: 1, vault: 1 });
    const hit = found.data!.items.find((item) => item.source === 'vault')!;
    expect(hit.path).toBe('Projects/MKT/Docs/Regale.md');
    expect(hit.cite).toMatch(/^\[Regale\]\(.*\/project\/MKT\/docs\?path=Projects%2FMKT/);

    const onlyNotes = await asOwner.knowledge.find.get({
      query: { q: 'Kühlregale', sources: 'vault' },
    });
    expect(onlyNotes.data!.items.map((item) => item.source)).toEqual(['vault']);
    const inFolder = await asOwner.knowledge.find.get({
      query: { q: 'Kühlregale', folder: 'Projects/MKT/Docs' },
    });
    expect(inFolder.data!.items.map((item) => item.ref)).toEqual([
      'vault:Projects/MKT/Docs/Regale.md',
    ]);

    const task = await asOwner.knowledge.items.get({ query: { ref: `issue:${issue.id}` } });
    expect(task.data).toMatchObject({ title: 'Kühlregale bestellen', projectKey: 'MKT' });
    expect(task.data!.text).toStartWith('MKT-1');
    expect((await asOwner.knowledge.items.get({ query: { ref: 'issue:999999' } })).status).toBe(
      404,
    );

    const mentions = await asOwner.knowledge.links.get({ query: { target: `issue:${issue.id}` } });
    expect(mentions.data!.map((item) => item.ref)).toContain('vault:Projects/MKT/Docs/Regale.md');
  });

  it('keeps each reader to what they may open', async () => {
    const { asOwner } = await setup();
    await note(asOwner, 'Private/Tagebuch.md', 'Geheimnis über Kühlregale');
    await note(asOwner, 'Projects/MKT/Docs/Offen.md', 'Kühlregale für alle');
    const stranger = authedApi((await signUpTestUser({ name: 'Stranger' })).cookie);
    await stranger.projects.post({ key: 'OTH', name: 'Other' });
    await runSources(knowledgeSources());
    const own = await asOwner.knowledge.find.get({ query: { q: 'Kühlregale' } });
    expect(own.data!.items.map((item) => item.ref)).toContain('vault:Private/Tagebuch.md');
    const theirs = await stranger.knowledge.find.get({ query: { q: 'Kühlregale' } });
    expect(theirs.data!.items).toEqual([]);
    expect(
      (await stranger.knowledge.items.get({ query: { ref: 'vault:Private/Tagebuch.md' } })).status,
    ).toBe(404);
    // Only the Administrator sees how far the index is.
    expect((await stranger.knowledge.sources.get()).status).toBe(403);
    const sources = await asOwner.knowledge.sources.get();
    expect(sources.data!.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining(['issue', 'vault', 'mail', 'chat', 'run', 'comment']),
    );
    expect(sources.data!.semantic).toMatchObject({ enabled: false });
  });

  it('gives agents search, reading, capture and records what they wrote', async () => {
    const { asOwner } = await setup();
    const project = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!.project;
    await asOwner.teams({ teamId: project.teamId }).mcp.patch({
      enabled: true,
      projects: [{ projectId: project.id, enabled: true }],
    });
    const agent = await createAgent(asOwner, 'MKT', {
      name: 'Researcher',
      username: 'researcher',
      kind: 'external',
    });
    const apiKey = agent.data!.apiKey!;
    const { tools } = await mcp(apiKey, 'tools/list');
    const names = (tools as { name: string }[]).map((tool) => tool.name);
    for (const name of ['search_knowledge', 'read_knowledge', 'capture_note', 'capture_web_page']) {
      expect(names).toContain(name);
    }

    const written = await mcp(apiKey, 'tools/call', {
      name: 'write_note',
      arguments: {
        path: 'Projects/MKT/Docs/Befund.md',
        content: 'Befund zu [[MKT-1]]: Lieferant B.',
      },
    });
    expect(written.isError).not.toBe(true);
    const [entry] = await db
      .select({ lastAuthor: vaultEntry.lastAuthor })
      .from(vaultEntry)
      .where(eq(vaultEntry.path, 'Projects/MKT/Docs/Befund.md'));
    expect(entry?.lastAuthor).toBe(`agent:${agent.data!.agent.id}`);

    const found = await mcp(apiKey, 'tools/call', {
      name: 'search_knowledge',
      arguments: { q: 'Lieferant' },
    });
    const result = (found.structuredContent as { data: { items: { ref: string; cite: string }[] } })
      .data;
    expect(result.items[0]?.ref).toBe('vault:Projects/MKT/Docs/Befund.md');
    expect(result.items[0]?.cite).toStartWith('[Befund](');

    const captured = await mcp(apiKey, 'tools/call', {
      name: 'capture_note',
      arguments: {
        title: 'Preisliste',
        text: 'Regal A kostet 400 €.',
        origin: 'https://example.com/preise',
        projectKey: 'MKT',
      },
    });
    expect(captured.isError).not.toBe(true);
    const capturedPath = (captured.structuredContent as { data: { path: string } }).data.path;
    expect(capturedPath).toMatch(/^Projects\/MKT\/Inbox\/\d{4}-\d\d-\d\d Preisliste\.md$/);
    expect(await readFile(path.join(root(), capturedPath), 'utf8')).toContain(
      'source: https://example.com/preise',
    );
    // The agent may not write Home's journal.
    const journal = await mcp(apiKey, 'tools/call', {
      name: 'capture_note',
      arguments: { title: 'x', text: 'x', target: 'journal' },
    });
    expect(journal.isError).toBe(true);
  });

  it('captures web pages, keeps a daily note and makes notes from templates', async () => {
    const { asOwner } = await setup();
    const html =
      '<html><head><title>Regal-Test</title><meta name="description" content="Drei Regale im Vergleich."></head><body><article><h1>Regal-Test</h1><p>Das erste Regal ist leise und passt in jede Küche, das zweite ist günstiger.</p></article></body></html>';
    const page = await asOwner.knowledge.capture.web.post({
      url: 'https://example.com/regale',
      html,
      projectKey: 'MKT',
    });
    expect(page.status).toBe(201);
    const text = await readFile(path.join(root(), page.data!.path!), 'utf8');
    expect(text).toContain('title: Regal-Test');
    expect(text).toContain('source: https://example.com/regale');
    expect(text).toContain('Das erste Regal ist leise');

    await seedTemplates('de');
    const templates = await asOwner.knowledge.templates.get();
    expect(templates.data!.map((template) => template.name)).toEqual([
      'Entscheidung',
      'Meeting',
      'Projektbrief',
      'Recherche',
      'Tagesnotiz',
    ]);
    const fromTemplate = await asOwner.knowledge.notes['from-template'].post({
      template: 'Templates/Meeting.md',
      folder: 'Projects/MKT/Docs',
      title: 'Kickoff mit Lieferant',
    });
    expect(fromTemplate.status).toBe(201);
    const meeting = await readFile(path.join(root(), fromTemplate.data!.path), 'utf8');
    expect(meeting).toContain('# Kickoff mit Lieferant');
    expect(meeting).not.toContain('{{');

    const today = await asOwner.knowledge.journal.post({});
    expect(today.data).toMatchObject({ created: true });
    expect(today.data!.path).toMatch(/^Home\/Journal\/\d{4}-\d\d-\d\d\.md$/);
    const line = await asOwner.knowledge.capture.post({
      target: 'journal',
      title: 'Idee: Regale mieten',
      text: 'Idee: Regale mieten',
    });
    expect(line.status).toBe(201);
    expect(line.data!.path).toBe(today.data!.path);
    const daily = await readFile(path.join(root(), today.data!.path), 'utf8');
    expect(daily).toMatch(/## Eingang\n[\s\S]*- \d\d:\d\d Idee: Regale mieten/);
  });

  it('round-trips a note between an outside editor and Helena', async () => {
    const { asOwner } = await setup();
    if (hasGit) {
      await git('init', '-q');
      await git('config', 'user.email', 'test@example.com');
      await git('config', 'user.name', 'Test');
    }
    const notePath = 'Projects/MKT/Docs/Rundreise.md';
    const created = await note(asOwner, notePath, '---\ntags: [test]\n---\nErste Fassung.\n');
    const firstSha = created.data!.sha256;

    // Obsidian (through Syncthing) changes the file; the worker's watcher indexes it.
    await writeFile(
      path.join(root(), notePath),
      '---\ntags: [test]\n---\nErste Fassung.\n\nZusatz aus Obsidian: Kühlkette.\n',
    );
    await indexVaultPaths([notePath]);
    await runSources(knowledgeSources());
    const read = await asOwner.knowledge.documents.get({ query: { path: notePath } });
    expect(read.data!.body).toContain('Zusatz aus Obsidian');
    const [entry] = await db
      .select({ lastAuthor: vaultEntry.lastAuthor })
      .from(vaultEntry)
      .where(eq(vaultEntry.path, notePath));
    expect(entry?.lastAuthor).toBe('extern');
    const found = await asOwner.knowledge.find.get({ query: { q: 'Kühlkette' } });
    expect(found.data!.items.map((item) => item.ref)).toContain(`vault:${notePath}`);

    // Helena's editor still holds the first version: its save is refused, not lost.
    const stale = await note(asOwner, notePath, 'Überschrieben', firstSha);
    expect(stale.status).toBe(409);

    // Saved on the new version, the change reaches the file with its frontmatter intact.
    const saved = await note(
      asOwner,
      notePath,
      `${read.data!.content}Antwort aus Helena.\n`,
      read.data!.sha256,
    );
    expect(saved.status).toBe(200);
    const onDisk = await readFile(path.join(root(), notePath), 'utf8');
    expect(onDisk).toBe(
      '---\ntags: [test]\n---\nErste Fassung.\n\nZusatz aus Obsidian: Kühlkette.\nAntwort aus Helena.\n',
    );
    if (hasGit) {
      const log = await git('log', '--format=%an|%B', '--', notePath);
      expect(log).toContain('Helena-Actor: user:');
    }
  });
});
