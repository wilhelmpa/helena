import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, readdir, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sha256 } from '../parse';
import {
  moveVaultFolder,
  pickVaultFolder,
  vaultAbsolute,
  writeNewVaultText,
  writeVaultFile,
} from '../vault-fs';
import {
  mailAttachmentFolder,
  mailNotePath,
  moveMailPath,
  safeFileName,
  safeSegment,
  withSuffix,
} from '../vault-path';

const date = new Date(2026, 2, 7, 12, 0, 0);

describe('mail vault paths', () => {
  it('builds the attachment folder of a project mail and of a Home mail', () => {
    expect(
      mailAttachmentFolder({
        projectKey: 'VOL',
        date,
        senderName: 'Jürgen Müller',
        subject: 'Rechnung März',
      }),
    ).toBe('Projects/VOL/Files/Mail/2026/03/2026-03-07 Jürgen Müller - Rechnung März');
    expect(mailAttachmentFolder({ projectKey: null, date, senderName: '', subject: '' })).toBe(
      'Home/Files/Mail/2026/03/2026-03-07 Unknown sender - No subject',
    );
  });

  it('builds the note path', () => {
    expect(mailNotePath({ projectKey: 'FAM', date, subject: 'Re: Urlaub?' })).toBe(
      'Projects/FAM/Docs/Mail/2026-03-07 Re Urlaub.md',
    );
  });

  it('removes characters a file system rejects and limits the length', () => {
    expect(safeSegment('a/b\\c:d*e?f"g<h>i|j', 'x')).toBe('a b c d e f g h i j');
    expect(safeSegment('...', 'fallback')).toBe('fallback');
    expect(safeSegment('ä'.repeat(300), 'x')).toHaveLength(120);
    const name = safeFileName(`${'n'.repeat(300)}.pdf`);
    expect(name.endsWith('.pdf')).toBe(true);
    expect(name.length).toBe(124);
    expect(safeFileName('')).toBe('attachment');
  });

  it('numbers a colliding name', () => {
    expect(withSuffix('report.pdf', 1, true)).toBe('report.pdf');
    expect(withSuffix('report.pdf', 2, true)).toBe('report (2).pdf');
    expect(withSuffix('2026-03-07 A - B.x', 3, false)).toBe('2026-03-07 A - B.x (3)');
  });

  it('moves a path to another project', () => {
    expect(moveMailPath('Projects/PRIV/Files/Mail/2026/03/x/a.pdf', 'VERV')).toBe(
      'Projects/VERV/Files/Mail/2026/03/x/a.pdf',
    );
    expect(moveMailPath('Projects/PRIV/Files/Mail/x', null)).toBe('Home/Files/Mail/x');
    expect(moveMailPath('Home/Files/Mail/x', 'VOL')).toBe('Projects/VOL/Files/Mail/x');
  });
});

describe('vault files', () => {
  const originalRoot = process.env.PROJECT_VAULT_ROOT;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'mail-vault-'));
    process.env.PROJECT_VAULT_ROOT = root;
  });

  afterEach(() => {
    if (originalRoot === undefined) delete process.env.PROJECT_VAULT_ROOT;
    else process.env.PROJECT_VAULT_ROOT = originalRoot;
  });

  it('writes a file, reuses identical content and numbers different content', async () => {
    const first = Buffer.from('one');
    const second = Buffer.from('two');
    const folder = 'Projects/VOL/Files/Mail/2026/03/x';
    expect(await writeVaultFile(folder, 'a.pdf', first, sha256(first))).toBe(`${folder}/a.pdf`);
    expect(await writeVaultFile(folder, 'a.pdf', first, sha256(first))).toBe(`${folder}/a.pdf`);
    expect(await writeVaultFile(folder, 'a.pdf', second, sha256(second))).toBe(
      `${folder}/a (2).pdf`,
    );
    expect(await readFile(path.join(root, folder, 'a (2).pdf'), 'utf8')).toBe('two');
  });

  it('writes a new note under a free name', async () => {
    expect(await writeNewVaultText('Home/Docs/Mail/n.md', 'a')).toBe('Home/Docs/Mail/n.md');
    expect(await writeNewVaultText('Home/Docs/Mail/n.md', 'b')).toBe('Home/Docs/Mail/n (2).md');
  });

  it('picks the first folder name nobody claims', async () => {
    const claimed = new Set(['F', 'F (2)']);
    expect(await pickVaultFolder('F', async (candidate) => claimed.has(candidate))).toBe('F (3)');
  });

  it('moves a folder, numbers a taken target and removes empty parents', async () => {
    const content = Buffer.from('x');
    await writeVaultFile('Projects/A/Files/Mail/2026/03/m', 'f.txt', content, sha256(content));
    await writeVaultFile('Projects/B/Files/Mail/2026/03/m', 'g.txt', content, sha256(content));
    const moved = await moveVaultFolder(
      'Projects/A/Files/Mail/2026/03/m',
      'Projects/B/Files/Mail/2026/03/m',
    );
    expect(moved).toBe('Projects/B/Files/Mail/2026/03/m (2)');
    expect(await readdir(path.join(root, moved))).toEqual(['f.txt']);
    expect(await readdir(path.join(root, 'Projects/A/Files/Mail'))).toEqual([]);
  });

  it('refuses paths outside the vault and writes through symbolic links', async () => {
    expect(() => vaultAbsolute('../etc/passwd')).toThrow('Invalid vault path');
    expect(() => vaultAbsolute('Home//x')).toThrow('Invalid vault path');
    const outside = await mkdtemp(path.join(tmpdir(), 'mail-outside-'));
    await mkdir(path.join(root, 'Home'), { recursive: true });
    await symlink(outside, path.join(root, 'Home', 'Files'));
    const content = Buffer.from('x');
    await expect(
      writeVaultFile('Home/Files/Mail/2026/03/x', 'a.txt', content, sha256(content)),
    ).rejects.toThrow('Symbolic links are not allowed in the vault');
  });
});
