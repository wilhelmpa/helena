// Writes the Docs pages that were stored in the database into the vault as Markdown
// files, before the migration that drops their tables. deploy.sh runs it ahead of the
// migrations; it does nothing once the tables are gone, and skips a file that exists.
//
//   bun --env-file=<env> apps/api/src/scripts/convert-documents-to-vault.ts
//
// A page becomes Projects/<KEY>/Docs/<title>.md, under the folders of its parent pages;
// an archived page goes to the trash (.trash/Projects/<KEY>/Docs/...), a private one to
// Private/Docs/<KEY>/. The work items a page was linked to become [[KEY-n]] links, and
// the files of the old one-way export (Docs/Plan/doc-<id>.md) move to the trash.
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { db } from '@repo/db';
import { sql } from 'drizzle-orm';
import { commitVaultPaths, PLAN_AUTHOR, vaultRoot } from '@repo/vault';

interface PageRow {
  id: number;
  parent_id: number | null;
  project_key: string;
  title: string;
  content: string;
  is_private: boolean;
  archived: boolean;
}

// A title as a file name: no path separators or characters Obsidian refuses.
export function fileName(title: string, id: number): string {
  const name = title
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120);
  return name || `Page ${id}`;
}

export function pageFolders(page: PageRow, byId: Map<number, PageRow>): string[] {
  const folders: string[] = [];
  const seen = new Set<number>([page.id]);
  for (let parent = page.parent_id; parent !== null;) {
    const row = byId.get(parent);
    if (!row || seen.has(row.id)) break;
    seen.add(row.id);
    folders.unshift(fileName(row.title, row.id));
    parent = row.parent_id;
  }
  return folders;
}

async function main(): Promise<void> {
  const [table] = (await db.execute(
    sql`select to_regclass('public.project_document') is not null as present`,
  )) as unknown as { present: boolean }[];
  if (!table?.present) {
    console.log('convert-documents: nothing to convert');
    return;
  }
  const pages = (await db.execute(sql`
    select d.id, d.parent_id, p.key as project_key, d.title, d.content, d.is_private,
      d.archived_at is not null as archived
    from project_document d join project p on p.id = d.project_id
    order by d.id
  `)) as unknown as PageRow[];
  const links = (await db.execute(sql`
    select l.document_id, p.key || '-' || i.sequence_number as identifier
    from project_document_issue l
    join issue i on i.id = l.issue_id
    join project p on p.id = i.project_id
  `)) as unknown as { document_id: number; identifier: string }[];

  const root = vaultRoot();
  const byId = new Map(pages.map((page) => [page.id, page]));
  const written: string[] = [];
  for (const page of pages) {
    const folders = pageFolders(page, byId);
    const relative = page.is_private
      ? path.join('Private', 'Docs', page.project_key, ...folders)
      : path.join(page.archived ? '.trash' : '', 'Projects', page.project_key, 'Docs', ...folders);
    const file = path.join(root, relative, `${fileName(page.title, page.id)}.md`);
    if (existsSync(file)) continue;
    const tasks = links.filter((link) => link.document_id === page.id);
    const body = [
      page.content.trimEnd(),
      ...(tasks.length > 0 ? ['', tasks.map((task) => `[[${task.identifier}]]`).join(' ')] : []),
      '',
    ].join('\n');
    await mkdir(path.dirname(file), { recursive: true, mode: 0o770 });
    await writeFile(file, body, { mode: 0o660 });
    written.push(path.relative(root, file));
  }

  const projects = [...new Set(pages.map((page) => page.project_key))];
  const exported: string[] = [];
  for (const key of projects) {
    const folder = path.join('Projects', key, 'Docs', 'Plan');
    const files = await readdir(path.join(root, folder)).catch(() => [] as string[]);
    const trash = path.join(root, '.trash', folder);
    for (const name of files.filter((entry) => /^doc-\d+\.md$/.test(entry))) {
      await mkdir(trash, { recursive: true, mode: 0o770 });
      await rename(path.join(root, folder, name), path.join(trash, name));
      exported.push(path.join(folder, name));
    }
  }

  await commitVaultPaths(
    [...written, ...exported],
    'Move the Docs pages from the database into the vault',
    PLAN_AUTHOR,
  );
  console.log(
    `convert-documents: wrote ${written.length} pages, moved ${exported.length} exported files to the trash`,
  );
}

if (import.meta.main) {
  await main();
  process.exit(0);
}
