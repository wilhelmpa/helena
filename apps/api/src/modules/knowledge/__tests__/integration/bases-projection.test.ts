import { beforeEach, expect, it } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { db, helenaReceipt, helenaReceiptOriginalLink } from '@repo/db';
import { splitNote } from '@repo/vault';
import { app, authedApi } from '#tests/helpers/app';
import { createAgent } from '#tests/helpers/agents';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

const root = () => process.env.PROJECT_VAULT_ROOT!;
type JsonData = Record<string, unknown> & {
  rows: Array<{ values: Record<string, unknown> }>;
  notes: Array<{ path: string; content: string }>;
  base: { path: string; content: string };
};

async function request(cookie: string, method: string, route: string, body?: unknown) {
  const result = await app.handle(
    new Request(`http://localhost${route}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: result.status, data: (await result.json()) as JsonData };
}

beforeEach(async () => {
  await resetDb();
  await rm(root(), { recursive: true, force: true });
  await mkdir(root(), { recursive: true });
});

it('enforces project ACL for Bases and evaluates only authorized notes', async () => {
  const owner = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(owner.cookie);
  await api.projects.post({ key: 'MKT', name: 'Marketing' });
  await api.knowledge.notes.put({
    path: 'Projects/MKT/Docs/One.md',
    content: '---\nstatus: active\nnet: 100\n---\nOne\n',
  });
  const base = 'Projects/MKT/Docs/Wissen.base';
  const content = `filters:\n  and:\n    - 'file.inFolder("Projects/MKT/Docs")'\n    - 'note.status == "active"'\nformulas:\n  gross: 'note.net * 1.19'\nviews:\n  - type: table\n    name: Wissen\n    order: [file.name, formula.gross]\n  - type: cards\n    name: Karten\n    order: [file.name]\n  - type: list\n    name: Liste\n    order: [file.name]\n`;
  const written = await request(owner.cookie, 'PUT', '/knowledge/bases', { path: base, content });
  expect(written.status).toBe(200);
  const query = encodeURIComponent(base);
  const rows = await request(owner.cookie, 'GET', `/knowledge/bases/rows?path=${query}`);
  expect(rows.status).toBe(200);
  expect(rows.data.total).toBe(1);
  expect(rows.data.rows[0].values['formula.gross']).toBe(119);
  const nextPage = await request(
    owner.cookie,
    'GET',
    `/knowledge/bases/rows?path=${query}&page=2&pageSize=1`,
  );
  expect(nextPage.data.total).toBe(1);
  expect(nextPage.data.rows).toHaveLength(0);
  expect(
    (await request(owner.cookie, 'GET', `/knowledge/bases/rows?path=${query}&view=Karten`)).data
      .total,
  ).toBe(1);
  expect(
    (await request(owner.cookie, 'GET', `/knowledge/bases/rows?path=${query}&view=Liste`)).data
      .total,
  ).toBe(1);
  expect((await request(owner.cookie, 'GET', `/knowledge/bases?path=${query}`)).data.content).toBe(
    content,
  );
  const search = await request(owner.cookie, 'GET', '/knowledge/search?q=Wissen');
  expect((search.data.items as Array<{ path: string }>).map((item) => item.path)).toContain(base);
  const templatePath = encodeURIComponent('Projects/MKT/Docs/Neu.md');
  const template = await request(
    owner.cookie,
    'GET',
    `/knowledge/properties-template?path=${templatePath}`,
  );
  expect((template.data.frontmatter as { project: string }).project).toBe('MKT');
  expect((template.data.frontmatter as { origin: string }).origin).toBe('manual');
  expect(template.data.content as string).toContain('# Neu\n');
  const unsupportedPath = 'Projects/MKT/Docs/Unsupported.base';
  const unsupported = `formulas:\n  next: 'date(now)'\nviews:\n  - type: table\n    name: Unsupported\n    order: [formula.next]\npluginSetting: keep\n`;
  expect(
    (
      await request(owner.cookie, 'PUT', '/knowledge/bases', {
        path: unsupportedPath,
        content: unsupported,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(
        owner.cookie,
        'GET',
        `/knowledge/bases/rows?path=${encodeURIComponent(unsupportedPath)}`,
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await request(
        owner.cookie,
        'GET',
        `/knowledge/bases?path=${encodeURIComponent(unsupportedPath)}`,
      )
    ).data.content,
  ).toBe(unsupported);

  const stranger = await signUpTestUser({ name: 'Stranger' });
  await authedApi(stranger.cookie).projects.post({ key: 'OTH', name: 'Other' });
  expect((await request(stranger.cookie, 'GET', `/knowledge/bases?path=${query}`)).status).toBe(
    403,
  );
  expect(
    (await request(stranger.cookie, 'GET', `/knowledge/bases/rows?path=${query}`)).status,
  ).toBe(403);
  expect(
    (await request(stranger.cookie, 'GET', `/knowledge/properties-template?path=${templatePath}`))
      .status,
  ).toBe(403);
});

it('keeps receipt projection off by default and counts a linked pair once when enabled', async () => {
  const owner = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(owner.cookie);
  await api.projects.post({ key: 'MKT', name: 'Marketing' });
  const info = (await api.projects.get()).data!.find((item) => item.key === 'MKT')!;
  const originals = await db
    .insert(helenaReceipt)
    .values([
      {
        projectId: info.id,
        teamId: info.teamId,
        source: 'upload',
        vaultPath: 'Projects/MKT/Files/Belege/2026-09/a.pdf',
        filename: 'a.pdf',
        sha256: 'a'.repeat(64),
        totalGross: '119.00',
        issuer: 'Lieferant',
      },
      {
        projectId: info.id,
        teamId: info.teamId,
        source: 'upload',
        vaultPath: 'Projects/MKT/Files/Belege/2026-09/b.pdf',
        filename: 'b.pdf',
        sha256: 'b'.repeat(64),
        totalGross: '119.00',
        issuer: 'Lieferant',
      },
    ])
    .returning({ id: helenaReceipt.id });
  await db.insert(helenaReceiptOriginalLink).values({
    projectId: info.id,
    teamId: info.teamId,
    primaryReceiptId: originals[0]!.id,
    receiptId: originals[1]!.id,
  });
  const rebuild = `/projects/MKT/receipts/projection/rebuild`;
  expect((await request(owner.cookie, 'POST', rebuild)).data.projected).toBe(0);
  const setting = `/teams/${info.teamId}/receipt-projection`;
  expect((await request(owner.cookie, 'GET', setting)).data.enabled).toBe(false);
  expect((await request(owner.cookie, 'PUT', setting, { enabled: true })).status).toBe(200);
  const projected = await request(owner.cookie, 'POST', rebuild);
  expect(projected.data.projected).toBe(1);
  const notePath = path.join(
    root(),
    `Projects/MKT/Files/Belege/${new Date().toISOString().slice(0, 7)}/${originals[0]!.id}.md`,
  );
  const note = splitNote(await readFile(notePath, 'utf8'));
  expect(note.frontmatter.originals).toHaveLength(2);
  expect(note.frontmatter.pair_id).toBe(originals[0]!.id);
  const basePath = 'Projects/MKT/Files/Belege/Belege.base';
  const rows = await request(
    owner.cookie,
    'GET',
    `/knowledge/bases/rows?path=${encodeURIComponent(basePath)}`,
  );
  expect(rows.data.total).toBe(1);
  expect(
    (
      await request(owner.cookie, 'PUT', '/knowledge/notes', {
        path: path.relative(root(), notePath).split(path.sep).join('/'),
        content: 'changed',
      })
    ).status,
  ).toBe(403);
  const relative = path
    .relative(path.join(root(), 'Projects/MKT'), notePath)
    .split(path.sep)
    .join('/');
  const file = await request(
    owner.cookie,
    'GET',
    `/projects/MKT/files/text?path=${encodeURIComponent(relative)}`,
  );
  expect(
    (
      await request(owner.cookie, 'PUT', '/projects/MKT/files/text', {
        path: relative,
        content: 'changed',
        expectedEtag: file.data.etag,
      })
    ).status,
  ).toBe(403);
  const changed = await request(
    owner.cookie,
    'PATCH',
    `/projects/MKT/receipts/${originals[0]!.id}`,
    { issuer: 'Neuer Lieferant' },
  );
  expect(changed.status).toBe(200);
  expect(splitNote(await readFile(notePath, 'utf8')).frontmatter.issuer).toBe('Neuer Lieferant');
  const snapshot = await readFile(notePath, 'utf8');
  await writeFile(notePath, `${snapshot}\nExtern bearbeitet`);
  expect((await request(owner.cookie, 'POST', rebuild)).status).toBe(409);
  await writeFile(notePath, snapshot);
  expect((await request(owner.cookie, 'PUT', setting, { enabled: false })).status).toBe(200);
  expect((await request(owner.cookie, 'POST', rebuild)).data.projected).toBe(0);
  expect(await readFile(notePath, 'utf8').catch(() => null)).toBeNull();
});

it('previews and materializes redacted agent notes without changing DB configuration', async () => {
  const owner = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(owner.cookie);
  await api.projects.post({ key: 'MKT', name: 'Marketing' });
  const created = await createAgent(api, 'MKT', { name: 'Scout', username: 'scout' });
  expect(created.status).toBe(201);
  const exported = await request(owner.cookie, 'GET', '/projects/MKT/agent-export');
  expect(exported.status).toBe(200);
  const scout = exported.data.notes.find((item) => item.content.includes('username: scout'))!;
  expect(scout).toBeDefined();
  expect(scout.content).toContain('agent_id:');
  expect(exported.data.base.content).toContain('name: Agenten');
  expect(scout.content).not.toContain('instructions:');
  expect(await readFile(path.join(root(), scout.path), 'utf8').catch(() => null)).toBeNull();
  const route = '/projects/MKT/agent-export/materialize';
  const written = await request(owner.cookie, 'POST', route);
  expect(written.status).toBe(200);
  expect(written.data.changed).toBeGreaterThan(0);
  expect(
    splitNote(await readFile(path.join(root(), scout.path), 'utf8')).frontmatter.username,
  ).toBe('scout');
  expect((await request(owner.cookie, 'POST', route)).data.changed).toBe(0);
  const baseRows = await request(
    owner.cookie,
    'GET',
    `/knowledge/bases/rows?path=${encodeURIComponent(exported.data.base.path)}`,
  );
  expect(baseRows.data.total).toBeGreaterThanOrEqual(1);
});
