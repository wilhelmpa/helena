import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { db, vaultEntry, vaultLink, vaultMove } from '@repo/db';
import { extractPending, requeueInstalledExtractions } from '../extraction-queue';
import { commitExternalChanges, commitVaultPaths, fileHistory } from '../git';
import { indexVaultPaths, rescanVault } from '../indexer';
import { findEntry, resolveVaultPath } from '../store';
import { startVaultWatcher, type VaultWatcher } from '../watcher';
import { resetNotesUidForTests } from '../writers';
import { has, tempDir, textPdf } from './fixtures';

let root = '';
const originalPath = process.env.PATH;

async function put(relative: string, content: string | Buffer) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), content);
}

async function git(...args: string[]): Promise<string> {
  const child = Bun.spawn(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' });
  await child.exited;
  return new Response(child.stdout).text();
}

async function until(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await Bun.sleep(50);
  }
}

beforeEach(async () => {
  const database = (process.env.DATABASE_URL ?? '').split('/').pop() ?? '';
  if (!database.includes('test')) throw new Error('refusing to run against a non-test database');
  await db.execute(sql`TRUNCATE vault_entry, vault_link, vault_move RESTART IDENTITY CASCADE`);
  root = tempDir('vault-index-');
  process.env.PROJECT_VAULT_ROOT = root;
});

afterEach(async () => {
  process.env.PATH = originalPath;
  await rm(root, { recursive: true, force: true });
});

describe('index', () => {
  it('indexes notes with their properties and links, files and folders', async () => {
    await put('Projects/VOL/Docs/Plan.md', '---\ntype: plan\ntags: [q4]\n---\nSee [[VOL-7]].\n');
    await put('Projects/VOL/Files/report.pdf', 'pdf');
    await put('Projects/VOL/Files/data.csv', 'a;b\n1;2\n');
    await put('.obsidian/workspace.json', '{}');
    await put('.trash/Old.md', 'old');

    await rescanVault();

    const note = await findEntry('Projects/VOL/Docs/Plan.md');
    expect(note).toMatchObject({
      kind: 'note',
      title: 'Plan',
      frontmatter: { type: 'plan', tags: ['q4'] },
      text: 'See [[VOL-7]].\n',
      extractionStatus: 'none',
    });
    const links = await db.select().from(vaultLink);
    expect(links.map((link) => [link.kind, link.target])).toEqual([['task', 'VOL-7']]);
    expect(await findEntry('Projects/VOL/Files/report.pdf')).toMatchObject({
      kind: 'file',
      mime: 'application/pdf',
      extractionStatus: 'pending',
    });
    expect(await findEntry('Projects/VOL/Files/data.csv')).toMatchObject({
      text: 'a;b\n1;2\n',
      extractionStatus: 'done',
    });
    expect(await findEntry('Projects/VOL/Docs')).toMatchObject({ kind: 'folder' });
    expect(await findEntry('.obsidian/workspace.json')).toBeNull();
    expect(await findEntry('.trash/Old.md')).toBeNull();
  });

  it('recognises a moved file by its content and keeps its row and links', async () => {
    await put('Projects/VOL/Docs/Draft.md', 'Draft with [[Target]]');
    await put('Projects/VOL/Files/scan.png', 'image bytes');
    await rescanVault();
    const note = (await findEntry('Projects/VOL/Docs/Draft.md'))!;
    const image = (await findEntry('Projects/VOL/Files/scan.png'))!;

    await mkdir(path.join(root, 'Projects/VOL/Docs/Final'), { recursive: true });
    await rename(
      path.join(root, 'Projects/VOL/Docs/Draft.md'),
      path.join(root, 'Projects/VOL/Docs/Final/Decision.md'),
    );
    await rename(path.join(root, 'Projects/VOL/Files'), path.join(root, 'Projects/VOL/Archive'));
    await indexVaultPaths([
      'Projects/VOL/Docs/Draft.md',
      'Projects/VOL/Docs/Final',
      'Projects/VOL/Files',
      'Projects/VOL/Archive',
    ]);

    expect(await findEntry('Projects/VOL/Docs/Draft.md')).toBeNull();
    expect(await findEntry('Projects/VOL/Docs/Final/Decision.md')).toMatchObject({
      id: note.id,
      title: 'Decision',
    });
    expect(await findEntry('Projects/VOL/Archive/scan.png')).toMatchObject({
      id: image.id,
      title: 'scan.png',
    });
    expect(await db.select({ id: vaultLink.entryId }).from(vaultLink)).toEqual([{ id: note.id }]);
    const moves = await db.select().from(vaultMove).orderBy(vaultMove.id);
    expect(moves.map((move) => [move.fromPath, move.toPath]).sort()).toEqual([
      ['Projects/VOL/Docs/Draft.md', 'Projects/VOL/Docs/Final/Decision.md'],
      ['Projects/VOL/Files/scan.png', 'Projects/VOL/Archive/scan.png'],
    ]);
    expect(await resolveVaultPath('Projects/VOL/Files/scan.png')).toBe(
      'Projects/VOL/Archive/scan.png',
    );
    expect(await resolveVaultPath('Projects/VOL/Gone.md', image.sha256)).toBe(
      'Projects/VOL/Archive/scan.png',
    );
    expect(await resolveVaultPath('Projects/VOL/Gone.md')).toBeNull();
  });

  it('repairs what changed while nobody watched', async () => {
    await put('Home/Docs/A.md', 'first');
    await put('Home/Docs/B.md', 'b');
    await rescanVault();
    await put('Home/Docs/A.md', 'second version');
    await rm(path.join(root, 'Home/Docs/B.md'));
    await put('Home/Docs/C.md', 'c');

    expect((await rescanVault()).changed).toBe(3);
    expect(await findEntry('Home/Docs/A.md')).toMatchObject({ text: 'second version' });
    expect(await findEntry('Home/Docs/B.md')).toBeNull();
    expect(await findEntry('Home/Docs/C.md')).not.toBeNull();
    expect((await rescanVault()).changed).toBe(0);
  });

  it('searches notes and extracted text in German and as plain words', async () => {
    await put('Projects/VOL/Docs/Budget.md', 'Die Rechnungen des Quartals');
    await rescanVault();
    const rows = await db
      .select({ path: vaultEntry.path })
      .from(vaultEntry)
      .where(sql`${vaultEntry.search} @@ websearch_to_tsquery('german', 'Rechnung')`);
    expect(rows).toEqual([{ path: 'Projects/VOL/Docs/Budget.md' }]);
  });
});

describe('extraction queue', () => {
  it('marks an extraction unavailable without the program and queues it again once it exists', async () => {
    await put('Projects/VOL/Files/invoice.pdf', textPdf(['Rechnung 4711']));
    await rescanVault();
    process.env.PATH = tempDir('vault-empty-path-');
    expect(await extractPending(5)).toBe(1);
    expect(await findEntry('Projects/VOL/Files/invoice.pdf')).toMatchObject({
      extractionStatus: 'unavailable',
      extractionError: 'missing: pdftotext',
    });

    process.env.PATH = originalPath;
    await requeueInstalledExtractions();
    const requeued = await findEntry('Projects/VOL/Files/invoice.pdf');
    if (!has('pdftotext')) {
      expect(requeued?.extractionStatus).toBe('unavailable');
      return;
    }
    expect(requeued?.extractionStatus).toBe('pending');
    await extractPending(5);
    const done = await findEntry('Projects/VOL/Files/invoice.pdf');
    expect(done?.extractionStatus).toBe('done');
    expect(done?.text).toContain('4711');
  });
});

describe.skipIf(!has('git'))('history', () => {
  it('commits text files only, as the author, and keeps binaries out', async () => {
    await git('init', '--quiet');
    await put('Projects/VOL/Docs/Note.md', 'one');
    await put('Projects/VOL/Files/photo.png', 'png');
    await commitVaultPaths(
      ['Projects/VOL/Docs/Note.md', 'Projects/VOL/Files/photo.png'],
      'Create note',
      { name: 'Ada', email: 'ada@example.com' },
    );
    expect(await git('log', '--format=%an|%s')).toBe('Ada|Create note\n');
    expect(await git('ls-files')).toBe('Projects/VOL/Docs/Note.md\n');

    await rm(path.join(root, 'Projects/VOL/Docs/Note.md'));
    await put('Home/Docs/External.md', 'from Obsidian');
    await commitVaultPaths(['Projects/VOL/Docs/Note.md'], 'Trash note', {
      name: 'Ada',
      email: 'ada@example.com',
    });
    await commitExternalChanges();
    expect(await git('log', '--format=%an|%s')).toBe(
      'extern|External changes\nAda|Trash note\nAda|Create note\n',
    );
    expect(await git('ls-files')).toBe('Home/Docs/External.md\n');
    expect((await fileHistory('Home/Docs/External.md')).map((entry) => entry.authorName)).toEqual([
      'extern',
    ]);
  });

  it('names the notes as the author of what they wrote, and only that', async () => {
    // The notes' account is this test's own user here; a real vault has helena-notes.
    process.env.HELENA_NOTES_UID = String(process.getuid!());
    resetNotesUidForTests();
    try {
      await git('init', '--quiet');
      await put('Home/Docs/Notiz.md', 'aus den Notizen');
      await put('Home/Docs/Agent.md', 'erst die Notizen');
      // An edit in place a while later: same owner, but the file was not born with it.
      const agent = path.join(root, 'Home/Docs/Agent.md');
      const born = (await stat(agent)).birthtimeMs;
      if (!born) return; // a file system without birth times attributes nothing to the notes
      await utimes(agent, new Date(), new Date(born + 60_000));
      await rescanVault();
      expect((await findEntry('Home/Docs/Notiz.md'))?.lastAuthor).toBe('notes');
      expect((await findEntry('Home/Docs/Agent.md'))?.lastAuthor).toBe('extern');
      await commitExternalChanges();
      expect(await git('log', '--format=%an|%s')).toBe(
        'extern|External changes\nNotizen|Changes in the notes\n',
      );
      const notesCommit = await git('log', '-1', '--author=Notizen', '--format=%B');
      expect(notesCommit).toContain('Helena-Actor: notes');
      expect(await git('show', '--name-only', '--format=', 'HEAD~1')).toBe('Home/Docs/Notiz.md\n');
    } finally {
      delete process.env.HELENA_NOTES_UID;
      resetNotesUidForTests();
    }
  });

  it('keeps Private in a repository of its own', async () => {
    await git('init', '--quiet');
    await mkdir(path.join(root, 'Private'));
    await Bun.spawn(['git', '-C', path.join(root, 'Private'), 'init', '--quiet']).exited;
    await put('Private/Diary.md', 'secret');
    await put('Home/Docs/Open.md', 'open');
    await commitVaultPaths(['Private/Diary.md', 'Home/Docs/Open.md'], 'Save', {
      name: 'Ada',
      email: 'ada@example.com',
    });
    expect(await git('ls-files')).toBe('Home/Docs/Open.md\n');
    const inner = Bun.spawn(['git', '-C', path.join(root, 'Private'), 'ls-files'], {
      stdout: 'pipe',
    });
    expect(await new Response(inner.stdout).text()).toBe('Diary.md\n');
  });
});

describe('watcher', () => {
  let watcher: VaultWatcher | null = null;

  afterEach(() => {
    watcher?.stop();
    watcher = null;
  });

  it('indexes changes as they happen and commits outside edits once the vault is quiet', async () => {
    if (has('git')) await git('init', '--quiet');
    watcher = startVaultWatcher({
      debounceMs: 50,
      commitQuietMs: 200,
      rescanIntervalMs: 60_000,
      extractionIntervalMs: 60_000,
    });
    await watcher.settled();

    await put('Projects/VOL/Docs/Live.md', 'Written in Obsidian with [[VOL-1]]');
    await until(async () => (await findEntry('Projects/VOL/Docs/Live.md')) !== null);

    await rename(
      path.join(root, 'Projects/VOL/Docs/Live.md'),
      path.join(root, 'Projects/VOL/Docs/Renamed.md'),
    );
    await until(async () => (await findEntry('Projects/VOL/Docs/Renamed.md')) !== null);
    expect(await findEntry('Projects/VOL/Docs/Live.md')).toBeNull();
    expect(await resolveVaultPath('Projects/VOL/Docs/Live.md')).toBe(
      'Projects/VOL/Docs/Renamed.md',
    );

    if (has('git')) {
      await until(async () => (await git('log', '--format=%an')).includes('extern'));
      expect(await git('ls-files')).toBe('Projects/VOL/Docs/Renamed.md\n');
    }
  });
});
