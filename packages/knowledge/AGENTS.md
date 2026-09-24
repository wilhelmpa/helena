# @helena/knowledge

Helena's second brain: the registry of knowledge sources and capture targets (the
`@helena/sdk` extension points `KnowledgeSource` and `CaptureTarget`), the built-in
sources, the one index over all of them, the search, capture, templates and daily notes.
The decision record is `docs/helena-decisions/second-brain.md`. The API and the worker
import it; the runner does not.

## Rules

- **The sources are the truth, the index is derived.** `knowledge_item`, `knowledge_link`,
  `knowledge_chunk` and `knowledge_source_state` can be truncated at any time; the worker's
  next run lists everything again (`resetSource` forces it for one source).
- **Every item carries its reach.** A source sets `scope` from the item's real access rule
  (project + role-matrix permission, team, or private owner), never wider. The API builds
  the reader's `KnowledgeReach` from the same rules its routes check
  (`apps/api/src/modules/knowledge/reach.ts`), and every query filters by it first.
- **Built-ins go through the same registry as plugins** (internal plugin
  `helena.knowledge`). Once a process has the framework's plugin host, it hands its
  registries in with `useKnowledgeRegistries` and loads `knowledgePlugin`.
- **Indexing:** `runSource` asks a source for what changed since its last run started, with
  a five-minute overlap, skips unchanged items by content hash, and sweeps for deleted
  ids every two minutes (`present(ids)`). A surface that knows what it changed calls
  `reindexItems` / `reindexVaultPaths` at once.
- **Links** use canonical targets: `task:VOL-12`, `vault:<path>`, `<source>:<id>`, a URL.
- **Semantic search is a switch** (`knowledge.semantic` setting). Passages keep `real[]`
  vectors, so no migration needs pgvector; with the extension installed,
  `ensureVectorIndex` adds an indexed `vector` column. The model runs in-process
  (Transformers.js) and is loaded by name only after the owner approved it.
- **Templates and daily notes** follow Obsidian's settings files in the vault; Helena
  seeds them once and then only reads them.

## Tests

`bun test` (loads `.env.test`; truncates the knowledge and vault index tables of the test
database and uses temporary vault roots).
