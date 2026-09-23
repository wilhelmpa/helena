import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';
import { freshVault } from '#tests/helpers/vault';

// The Files routes over a vault and a workspace of their own per test, so nothing one
// test writes is seen by the next.

let vault: string;
let workspaces: string;
const originalWorkspaces = process.env.PROJECT_WORKSPACE_ROOT;

beforeEach(async () => {
  await resetDb();
  vault = freshVault();
  workspaces = mkdtempSync(path.join(tmpdir(), 'files-workspaces-'));
  process.env.PROJECT_WORKSPACE_ROOT = workspaces;
});

afterEach(() => {
  process.env.PROJECT_WORKSPACE_ROOT = originalWorkspaces;
});

async function setup() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  return { owner, asOwner, files: asOwner.projects({ projectKey: 'MKT' }).files };
}

const file = (content: string, name: string, type = 'application/octet-stream') =>
  new File([content], name, { type });

// A route whose body is the file itself, read through the app directly.
function raw(cookie: string, url: string, headers: Record<string, string> = {}) {
  return app.handle(new Request(`http://localhost${url}`, { headers: { cookie, ...headers } }));
}

const vaultFile = (...parts: string[]) => path.join(vault, ...parts);

describe('project files', () => {
  it('lists an empty project folder before anything was written', async () => {
    const { files } = await setup();
    const listing = await files.get({ query: {} });
    expect(listing.status).toBe(200);
    expect(listing.data).toMatchObject({
      root: 'vault',
      path: '',
      vaultPath: 'Projects/MKT',
      writable: true,
      items: [],
    });
  });

  it('uploads files into a folder and numbers a name that is taken', async () => {
    const { files } = await setup();
    expect((await files.folders.post({ path: 'Rechnungen' })).status).toBe(201);
    const first = await files.upload.post(
      { files: [file('one', 'Rechnung.pdf'), file('two', 'Rechnung.pdf')] },
      { query: { path: 'Rechnungen' } },
    );
    expect(first.status).toBe(201);
    expect(first.data!.map((item) => item.path)).toEqual([
      'Rechnungen/Rechnung.pdf',
      'Rechnungen/Rechnung (2).pdf',
    ]);
    expect(readFileSync(vaultFile('Projects/MKT/Rechnungen/Rechnung (2).pdf'), 'utf8')).toBe('two');

    const listing = await files.get({ query: { path: 'Rechnungen' } });
    expect(listing.data!.items.map((item) => [item.name, item.kind, item.contentType])).toEqual([
      ['Rechnung (2).pdf', 'file', 'application/pdf'],
      ['Rechnung.pdf', 'file', 'application/pdf'],
    ]);
  });

  it('makes an uploaded name safe for every synced system', async () => {
    const { files } = await setup();
    const uploaded = await files.upload.post({ files: [file('x', '..hidden: a?*.txt ')] });
    expect(uploaded.data![0].name).toBe('hidden_ a__.txt');
  });

  it('refuses a file past the upload limit', async () => {
    const { asOwner, files } = await setup();
    await asOwner.god['storage-settings'].put({ maxAttachmentMb: 1 });
    const big = file('x'.repeat(1024 * 1024 + 1), 'big.bin');
    expect((await files.upload.post({ files: [big] })).status).toBe(413);
  });

  it('creates a text file once and reads it back', async () => {
    const { files } = await setup();
    expect((await files.text.post({ path: 'Notes/todo.md', content: '# Todo' })).status).toBe(201);
    expect((await files.text.post({ path: 'Notes/todo.md', content: 'again' })).status).toBe(409);
    expect((await files.text.post({ path: 'Notes/run.sh', content: 'x' })).status).toBe(400);
    const read = await files.text.get({ query: { path: 'Notes/todo.md' } });
    expect(read.data).toMatchObject({ path: 'Notes/todo.md', content: '# Todo' });
  });

  it('refuses a second folder of the same name', async () => {
    const { files } = await setup();
    expect((await files.folders.post({ path: 'Docs' })).status).toBe(201);
    expect((await files.folders.post({ path: 'Docs' })).status).toBe(409);
  });

  it('renames and moves entries and refuses a taken target', async () => {
    const { files } = await setup();
    await files.upload.post({ files: [file('a', 'a.txt'), file('b', 'b.txt')] });
    await files.folders.post({ path: 'Archiv' });

    const renamed = await files.move.post({ from: 'a.txt', to: 'Angebot.txt' });
    expect(renamed.data).toEqual({ path: 'Angebot.txt' });
    expect((await files.move.post({ from: 'Angebot.txt', to: 'Archiv/Angebot.txt' })).status).toBe(
      200,
    );
    expect(existsSync(vaultFile('Projects/MKT/Archiv/Angebot.txt'))).toBe(true);

    expect((await files.move.post({ from: 'b.txt', to: 'Archiv/Angebot.txt' })).status).toBe(409);
    expect((await files.move.post({ from: 'Archiv', to: 'Archiv/Inner' })).status).toBe(400);
    expect((await files.move.post({ from: 'missing.txt', to: 'x.txt' })).status).toBe(404);
    expect((await files.move.post({ from: 'b.txt', to: 'Nowhere/b.txt' })).status).toBe(404);
  });

  it("moves a deleted entry to the vault's trash at the same path", async () => {
    const { files } = await setup();
    await files.upload.post({ files: [file('v1', 'plan.txt')] }, { query: { path: 'Docs' } });
    expect((await files.delete({}, { query: { path: 'Docs/plan.txt' } })).status).toBe(204);
    await files.upload.post({ files: [file('v2', 'plan.txt')] }, { query: { path: 'Docs' } });
    expect((await files.delete({}, { query: { path: 'Docs/plan.txt' } })).status).toBe(204);

    expect((await files.get({ query: { path: 'Docs' } })).data!.items).toEqual([]);
    expect(readFileSync(vaultFile('.trash/Projects/MKT/Docs/plan.txt'), 'utf8')).toBe('v1');
    expect(readFileSync(vaultFile('.trash/Projects/MKT/Docs/plan (2).txt'), 'utf8')).toBe('v2');
    expect((await files.delete({}, { query: { path: '' } })).status).toBe(400);
  });

  it('keeps every path inside the project folder', async () => {
    const { owner, files } = await setup();
    for (const bad of ['../KEY', '/etc', 'a/../../b', 'a//b', 'back\\slash', '.git', 'a/.env']) {
      expect((await files.get({ query: { path: bad } })).status).toBe(400);
    }
    mkdirSync(vaultFile('Projects/MKT'), { recursive: true });
    mkdirSync(vaultFile('Projects/OTHER'), { recursive: true });
    symlinkSync(vaultFile('Projects/OTHER'), vaultFile('Projects/MKT/link'));
    expect((await files.get({ query: { path: 'link' } })).status).toBe(400);
    expect(
      (await files.upload.post({ files: [file('x', 'x.txt')] }, { query: { path: 'link' } }))
        .status,
    ).toBe(400);
    // Neither the link nor a hidden entry is listed, and a hidden entry cannot be named.
    writeFileSync(vaultFile('Projects/MKT/.hidden'), 'x');
    expect((await files.get({ query: {} })).data!.items).toEqual([]);
    expect((await raw(owner.cookie, '/projects/MKT/files/raw?path=.hidden')).status).toBe(400);
    expect((await files.move.post({ from: 'x.txt', to: '.x.txt' })).status).toBe(400);
  });

  it('leaves out Syncthing conflict copies of an otherwise listed file', async () => {
    const { files } = await setup();
    mkdirSync(vaultFile('Projects/MKT'), { recursive: true });
    writeFileSync(vaultFile('Projects/MKT/Note.md'), 'a');
    writeFileSync(vaultFile('Projects/MKT/Note.sync-conflict-20260923-101500-ABCDEF7.md'), 'b');
    expect((await files.get({ query: {} })).data!.items.map((item) => item.name)).toEqual([
      'Note.md',
    ]);
  });

  it('opens safe kinds inline and everything else as a download', async () => {
    const { owner, files } = await setup();
    await files.upload.post({
      files: [
        file('%PDF-1.4', 'scan.pdf'),
        file('<script>1</script>', 'page.html'),
        file('hi', 'a.ts'),
      ],
    });
    const base = '/projects/MKT/files/raw?path=';

    const pdf = await raw(owner.cookie, `${base}scan.pdf`);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toStartWith('inline;');
    expect(pdf.headers.get('x-content-type-options')).toBe('nosniff');
    expect(pdf.headers.get('content-security-policy')).toBeNull();

    const html = await raw(owner.cookie, `${base}page.html`);
    expect(html.headers.get('content-disposition')).toStartWith('attachment;');
    expect(html.headers.get('content-security-policy')).toContain('sandbox');

    const code = await raw(owner.cookie, `${base}a.ts`);
    expect(code.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(code.headers.get('content-disposition')).toStartWith('inline;');

    const forced = await raw(owner.cookie, `${base}scan.pdf&download=1`);
    expect(forced.headers.get('content-disposition')).toStartWith('attachment;');

    const range = await raw(owner.cookie, `${base}scan.pdf`, { range: 'bytes=1-3' });
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe('bytes 1-3/8');
    expect(await range.text()).toBe('PDF');

    const cached = await raw(owner.cookie, `${base}scan.pdf`, {
      'if-none-match': pdf.headers.get('etag')!,
    });
    expect(cached.status).toBe(304);
    expect((await raw(owner.cookie, `${base}missing.pdf`)).status).toBe(404);
  });

  it('reads the workspace but never writes it', async () => {
    const { owner, files } = await setup();
    expect((await files.get({ query: { root: 'code' } })).status).toBe(404);
    mkdirSync(path.join(workspaces, 'mkt', 'src'), { recursive: true });
    writeFileSync(path.join(workspaces, 'mkt', 'src', 'index.ts'), 'export {}');

    const listing = await files.get({ query: { root: 'code', path: 'src' } });
    expect(listing.data).toMatchObject({
      root: 'code',
      vaultPath: null,
      writable: false,
      absolutePath: path.join(workspaces, 'mkt', 'src'),
      items: [{ name: 'index.ts', kind: 'file' }],
    });
    const opened = await raw(owner.cookie, '/projects/MKT/files/raw?root=code&path=src/index.ts');
    expect(await opened.text()).toBe('export {}');

    const upload = await files.upload.post(
      { files: [file('x', 'x.txt')] },
      { query: { root: 'code', path: 'src' } },
    );
    expect(upload.status).toBe(403);
    expect(upload.error!.value).toMatchObject({ code: 'read_only' });
  });

  it('says so when Plan may not read the workspace', async () => {
    if (process.getuid?.() === 0) return;
    const { files } = await setup();
    mkdirSync(path.join(workspaces, 'mkt'));
    chmodSync(path.join(workspaces, 'mkt'), 0o000);
    try {
      const listing = await files.get({ query: { root: 'code' } });
      expect(listing.status).toBe(403);
      expect(listing.error!.value).toMatchObject({ code: 'not_readable' });
    } finally {
      chmodSync(path.join(workspaces, 'mkt'), 0o700);
    }
  });

  it('checks the documents permissions per action', async () => {
    const { asOwner, files } = await setup();
    await files.upload.post({ files: [file('x', 'x.txt')] });
    const reader = await createRole(asOwner, 'MKT', {
      name: 'Reader',
      permissions: { documents: { read: true } },
    });
    const asReader = (await addProjectMember(asOwner, 'MKT', reader.data!.id)).projects({
      projectKey: 'MKT',
    }).files;
    expect((await asReader.get({ query: {} })).status).toBe(200);
    expect((await asReader.upload.post({ files: [file('y', 'y.txt')] })).status).toBe(403);
    expect((await asReader.move.post({ from: 'x.txt', to: 'z.txt' })).status).toBe(403);
    expect((await asReader.delete({}, { query: { path: 'x.txt' } })).status).toBe(403);

    const outsider = authedApi((await signUpTestUser()).cookie);
    expect((await outsider.projects({ projectKey: 'MKT' }).files.get({ query: {} })).status).toBe(
      403,
    );
  });
});

describe('home files', () => {
  async function users(): Promise<{ god: Api; godCookie: string; person: Api }> {
    const god = await signUpTestUser();
    const person = await signUpTestUser();
    return { god: authedApi(god.cookie), godCookie: god.cookie, person: authedApi(person.cookie) };
  }

  it('lets every person use Home and Templates', async () => {
    const { person } = await users();
    const upload = await person.files.upload.post(
      { files: [file('x', 'Vorlage.md')] },
      { query: { root: 'templates' } },
    );
    expect(upload.status).toBe(201);
    expect(existsSync(vaultFile('Templates/Vorlage.md'))).toBe(true);
    const listing = await person.files.get({ query: { root: 'home' } });
    expect(listing.data).toMatchObject({ vaultPath: 'Home', items: [] });
  });

  it('keeps Private to the owner and never creates it', async () => {
    const { god, godCookie, person } = await users();
    expect((await god.files.get({ query: { root: 'private' } })).status).toBe(404);
    expect(
      (
        await god.files.upload.post(
          { files: [file('x', 'tax.pdf')] },
          { query: { root: 'private' } },
        )
      ).status,
    ).toBe(404);
    mkdirSync(vaultFile('Private'));
    expect(
      (
        await god.files.upload.post(
          { files: [file('x', 'tax.pdf')] },
          { query: { root: 'private' } },
        )
      ).status,
    ).toBe(201);
    expect((await person.files.get({ query: { root: 'private' } })).status).toBe(403);
    expect((await raw(godCookie, '/files/raw?root=private&path=tax.pdf')).status).toBe(200);

    // Its trash stays inside it, away from the vault trash the agents read.
    expect(
      (await god.files.delete({}, { query: { root: 'private', path: 'tax.pdf' } })).status,
    ).toBe(204);
    expect(existsSync(vaultFile('Private/.trash/tax.pdf'))).toBe(true);
    expect(existsSync(vaultFile('.trash/Private'))).toBe(false);
  });
});
