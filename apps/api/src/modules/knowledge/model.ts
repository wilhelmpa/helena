import { t } from 'elysia';

const vaultPath = (description: string) => t.String({ maxLength: 1024, description });

const EntryKind = t.Union([t.Literal('note'), t.Literal('file'), t.Literal('folder')]);

export const pathQuery = t.Object({
  path: vaultPath('Vault-relative path, e.g. "Projects/VOL/Docs/Spec.md".'),
});

export const documentQuery = t.Object({
  path: vaultPath('Vault-relative path of a note or file, e.g. "Projects/VOL/Docs/Spec.md".'),
  maxChars: t.Optional(
    t.Numeric({
      minimum: 1000,
      maximum: 2_000_000,
      description: 'Longest text returned; longer content is cut and marked truncated.',
    }),
  ),
});

export const folderQuery = t.Object({
  path: t.Optional(
    vaultPath('Vault-relative folder, e.g. "Projects/VOL/Docs". Empty lists the vault root.'),
  ),
});

export const treeQuery = t.Object({
  root: vaultPath('The folder whose notes and folders to list, e.g. "Projects/VOL/Docs".'),
});

export const recentQuery = t.Object({
  root: vaultPath('The folder whose files to list, newest first, e.g. "Projects/VOL".'),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200, default: 50 })),
});

export const searchQuery = t.Object({
  q: t.String({ minLength: 1, maxLength: 200, description: 'Words to search for.' }),
  folder: t.Optional(
    vaultPath('Only search below this folder, e.g. "Projects/VOL" or "Templates".'),
  ),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50, default: 20 })),
});

export const backlinksQuery = t.Object({
  path: t.Optional(vaultPath('The note or file whose backlinks to list.')),
  task: t.Optional(
    t.String({
      maxLength: 64,
      description: 'A task identifier such as "VOL-12": the notes that link [[VOL-12]].',
    }),
  ),
});

export const resolveQuery = t.Object({
  path: vaultPath('The path a reference stored.'),
  sha256: t.Optional(t.String({ pattern: '^[0-9a-f]{64}$' })),
});

export const wikilinkQuery = t.Object({
  from: vaultPath('The note the link is in.'),
  target: t.String({ minLength: 1, maxLength: 1024, description: 'The link target as written.' }),
});

export const versionQuery = t.Object({
  path: vaultPath('Vault-relative path of a note.'),
  commit: t.String({ pattern: '^[0-9a-f]{7,64}$' }),
});

export const rawQuery = t.Object({
  path: vaultPath('Vault-relative path of a file.'),
  download: t.Optional(t.String()),
});

export const writeNoteBody = t.Object({
  path: vaultPath('Vault-relative path of the note, ending in ".md".'),
  content: t.Optional(
    t.String({
      maxLength: 2_000_000,
      description: 'The whole file: Markdown, with its YAML frontmatter if it has one.',
    }),
  ),
  body: t.Optional(
    t.String({
      maxLength: 2_000_000,
      description:
        'The Markdown without frontmatter; send it with `frontmatter` instead of `content`.',
    }),
  ),
  frontmatter: t.Optional(
    t.Record(t.String(), t.Any(), {
      description: 'The frontmatter properties that go with `body`; {} writes none.',
    }),
  ),
  expectedSha: t.Optional(
    t.Nullable(
      t.String({
        pattern: '^[0-9a-f]{64}$',
        description:
          'sha256 of the note as last read. Omit or null to create a new note; a note that changed since returns 409.',
      }),
    ),
  ),
});

export const moveBody = t.Object({
  from: vaultPath('The note or folder to move.'),
  to: vaultPath('Its new path.'),
});

export const pathBody = t.Object({
  path: vaultPath('Vault-relative path.'),
});

export const uploadAssetQuery = t.Object({
  path: vaultPath('The note the file is added to.'),
});

export const uploadAssetBody = t.Object({ file: t.File() });

export const TreeResponse = t.Object({
  root: t.String(),
  items: t.Array(
    t.Object({
      path: t.String(),
      name: t.String(),
      kind: t.Union([t.Literal('note'), t.Literal('folder')]),
      title: t.String(),
      updatedAt: t.Nullable(t.String()),
    }),
  ),
});

export const RecentResponse = t.Object({
  root: t.String(),
  items: t.Array(
    t.Object({
      path: t.String(),
      name: t.String(),
      kind: t.Union([t.Literal('note'), t.Literal('file')]),
      title: t.String(),
      mime: t.Nullable(t.String()),
      sizeBytes: t.Nullable(t.Number()),
      updatedAt: t.Nullable(t.String()),
    }),
  ),
});

export const FolderResponse = t.Object({
  path: t.String(),
  items: t.Array(
    t.Object({
      path: t.String(),
      name: t.String(),
      kind: EntryKind,
      title: t.String(),
      mime: t.Nullable(t.String()),
      sizeBytes: t.Nullable(t.Number()),
      updatedAt: t.Nullable(t.String()),
      extractionStatus: t.Nullable(t.String()),
    }),
  ),
});

export const DocumentResponse = t.Object({
  path: t.String(),
  kind: t.Union([t.Literal('note'), t.Literal('file')]),
  title: t.String(),
  mime: t.String(),
  sizeBytes: t.Number(),
  sha256: t.String(),
  updatedAt: t.String(),
  projectKey: t.Nullable(t.String()),
  content: t.String({ description: 'A note as written, or the text extracted from a file.' }),
  frontmatter: t.Record(t.String(), t.Any()),
  body: t.String({ description: 'A note without its frontmatter.' }),
  truncated: t.Boolean(),
  extractionStatus: t.String(),
  absolutePath: t.String({
    description: 'Where the file is on the server, for tools that open files (e.g. vision).',
  }),
});

export const WriteNoteResponse = t.Object({
  path: t.String(),
  sha256: t.String(),
  created: t.Boolean(),
  title: t.String(),
});

export const SearchResponse = t.Object({
  items: t.Array(
    t.Object({
      path: t.String(),
      title: t.String(),
      kind: EntryKind,
      projectKey: t.Nullable(t.String()),
      snippet: t.String(),
      rank: t.Number(),
      updatedAt: t.Nullable(t.String()),
    }),
  ),
});

export const LinkedNoteListResponse = t.Array(
  t.Object({
    path: t.String(),
    title: t.String(),
    projectKey: t.Nullable(t.String()),
    updatedAt: t.Nullable(t.String()),
  }),
);

export const PathResponse = t.Object({ path: t.String() });

export const ResolveResponse = t.Object({ path: t.Nullable(t.String()) });

export const TrashListResponse = t.Array(t.Object({ path: t.String(), trashedAt: t.String() }));

export const ConflictListResponse = t.Array(
  t.Object({ path: t.String(), original: t.String(), updatedAt: t.String() }),
);

export const HistoryResponse = t.Array(
  t.Object({
    commit: t.String(),
    authorName: t.String(),
    committedAt: t.String(),
    message: t.String(),
  }),
);

export const VersionResponse = t.Object({
  path: t.String(),
  commit: t.String(),
  content: t.String(),
});
