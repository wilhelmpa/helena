import { t } from 'elysia';

// Schemas of the one search over every knowledge source (everything.ts) and of capture,
// the journal and templates (capture.ts).

const Metadata = t.Record(t.String(), t.Any());

export const findQuery = t.Object({
  q: t.String({ minLength: 1, maxLength: 200, description: 'Words to search for.' }),
  sources: t.Optional(
    t.String({
      maxLength: 200,
      description:
        'Only these kinds, comma-separated: issue (tasks), comment, vault (notes and files), mail, chat, run (agent runs). All when left out.',
    }),
  ),
  project: t.Optional(
    t.String({ maxLength: 32, description: 'Only one project, by key, e.g. "VOL".' }),
  ),
  folder: t.Optional(
    t.String({
      maxLength: 1024,
      description: 'Only notes and files below this vault folder, e.g. "Projects/VOL/Docs".',
    }),
  ),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50, default: 20 })),
});

// The composer lists recent items before a person types, then searches the same index.
export const pickerQuery = t.Object({
  q: t.Optional(t.String({ maxLength: 200 })),
  sources: t.Optional(t.String({ maxLength: 200 })),
  kind: t.Optional(t.String({ maxLength: 64 })),
  project: t.Optional(t.String({ maxLength: 32 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50, default: 20 })),
});

const Hit = t.Object({
  ref: t.String({ description: 'The item as `<source>:<id>`; read it with read_knowledge.' }),
  source: t.String(),
  id: t.String(),
  title: t.String(),
  snippet: t.String({ description: 'Where it matched, matches in **bold**.' }),
  href: t.String({ description: 'Where the item opens in {appName}.' }),
  url: t.String({ description: 'The same as an absolute link.' }),
  cite: t.String({ description: 'A Markdown link to put into an answer as its source.' }),
  path: t.Nullable(t.String({ description: 'The vault path, for notes and files.' })),
  projectKey: t.Nullable(t.String()),
  mimeType: t.Nullable(t.String()),
  metadata: Metadata,
  author: t.Nullable(t.String()),
  origin: t.Nullable(t.String()),
  runId: t.Nullable(t.Number()),
  updatedAt: t.String(),
  matched: t.Array(t.String()),
});

export const FindResponse = t.Object({
  items: t.Array(Hit),
  counts: t.Record(t.String(), t.Number()),
  semantic: t.Boolean(),
});

export const itemQuery = t.Object({
  ref: t.String({
    minLength: 3,
    maxLength: 1100,
    description: 'The item as search_knowledge returned it, e.g. "issue:481" or "mail:12".',
  }),
  maxChars: t.Optional(t.Numeric({ minimum: 1000, maximum: 200_000, default: 50_000 })),
});

export const ItemResponse = t.Object({
  ref: t.String(),
  source: t.String(),
  id: t.String(),
  title: t.String(),
  text: t.String(),
  truncated: t.Boolean(),
  href: t.String(),
  url: t.String(),
  cite: t.String(),
  path: t.Nullable(t.String()),
  projectKey: t.Nullable(t.String()),
  mimeType: t.Nullable(t.String()),
  metadata: Metadata,
  author: t.Nullable(t.String()),
  origin: t.Nullable(t.String()),
  runId: t.Nullable(t.Number()),
  createdAt: t.String(),
  updatedAt: t.String(),
  links: t.Array(t.Object({ target: t.String(), kind: t.String() })),
});

export const linksQuery = t.Object({
  target: t.String({
    minLength: 3,
    maxLength: 1100,
    description:
      'What is linked: a task ("task:VOL-12"), an item ref ("issue:481", "mail:12") or a vault path ("vault:Projects/VOL/Docs/Plan.md").',
  }),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 50 })),
});

export const LinksResponse = t.Array(
  t.Object({
    ref: t.String(),
    source: t.String(),
    id: t.String(),
    title: t.String(),
    href: t.String(),
    projectKey: t.Nullable(t.String()),
    kind: t.String(),
    updatedAt: t.String(),
    metadata: Metadata,
  }),
);

export const SourcesResponse = t.Object({
  sources: t.Array(
    t.Object({
      id: t.String(),
      label: t.Any(),
      icon: t.Nullable(t.String()),
      pluginId: t.Nullable(t.String()),
      items: t.Number(),
      lastRunAt: t.Nullable(t.String()),
      lastSweepAt: t.Nullable(t.String()),
      lastError: t.Nullable(t.String()),
    }),
  ),
  semantic: t.Object({
    enabled: t.Boolean(),
    pgvector: t.Boolean(),
    model: t.Nullable(t.String()),
    passages: t.Number(),
    embedded: t.Number(),
    problem: t.Nullable(t.String()),
  }),
});

export const semanticBody = t.Object({
  enabled: t.Boolean(),
  model: t.Optional(t.String({ minLength: 1, maxLength: 300 })),
});

export const sourceParams = t.Object({ source: t.String({ maxLength: 128 }) });

export const captureBody = t.Object({
  target: t.Optional(
    t.String({
      maxLength: 128,
      description:
        'Where it goes: "inbox" (a new note in the Inbox, default) or "journal" (a line in today\'s daily note).',
    }),
  ),
  kind: t.Optional(
    t.Union(
      [
        t.Literal('text'),
        t.Literal('chat-message'),
        t.Literal('web-page'),
        t.Literal('mail-message'),
        t.Literal('issue'),
        t.Literal('file'),
      ],
      { default: 'text' },
    ),
  ),
  title: t.String({ minLength: 1, maxLength: 200 }),
  text: t.String({ maxLength: 500_000, description: 'Markdown.' }),
  origin: t.Optional(t.String({ maxLength: 2000, description: 'The page or mail it came from.' })),
  from: t.Optional(
    t.String({ maxLength: 1100, description: 'The {appName} item it came from, `<source>:<id>`.' }),
  ),
  projectKey: t.Optional(
    t.String({ maxLength: 32, description: "The project's Inbox; Home's without one." }),
  ),
  tags: t.Optional(t.Array(t.String({ maxLength: 64 }), { maxItems: 20 })),
});

export const CaptureResponse = t.Object({
  item: t.String(),
  href: t.String(),
  path: t.Nullable(t.String()),
});

export const captureWebBody = t.Object({
  url: t.String({ minLength: 8, maxLength: 2000, description: 'The page, http(s).' }),
  html: t.Optional(
    t.String({
      maxLength: 5_000_000,
      description: 'The page as the browser shows it. Fetched from the URL when left out.',
    }),
  ),
  projectKey: t.Optional(t.String({ maxLength: 32 })),
  tags: t.Optional(t.Array(t.String({ maxLength: 64 }), { maxItems: 20 })),
});

export const journalBody = t.Object({
  date: t.Optional(t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Default: today.' })),
});

export const JournalResponse = t.Object({ path: t.String(), created: t.Boolean() });

export const TemplatesResponse = t.Array(t.Object({ path: t.String(), name: t.String() }));

export const fromTemplateBody = t.Object({
  template: t.String({
    maxLength: 1024,
    description: 'The template note, e.g. "Templates/Meeting.md".',
  }),
  folder: t.String({ maxLength: 1024, description: 'Where the new note goes.' }),
  title: t.String({ minLength: 1, maxLength: 200 }),
});

export const NoteCreatedResponse = t.Object({ path: t.String() });

export const CaptureTargetsResponse = t.Array(
  t.Object({
    id: t.String(),
    label: t.Any(),
    icon: t.Nullable(t.String()),
    accepts: t.Array(t.String()),
    pluginId: t.String(),
  }),
);
