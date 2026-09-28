# Decision: the second brain (knowledge, files, search, capture)

The shared vault stores Markdown, files and boards. Helena's native Docs editor, Files viewer,
agents and Syncthing devices use the same files. The owner requires portable files, one derived
index, and AGPL-compatible dependencies.

## What already existed (and stays)

Knowledge concept D1–D5 (`docs/volition-konzept-wissen-zugaenge-mail.md`) is built: the vault (`PROJECT_VAULT_ROOT`) is the truth; Helena Docs (TipTap) edit Markdown files in it; `vault_entry` / `vault_link` / `vault_move` are a derived index with German full-text search; the vault is a git repository (Private/ its own); the worker's watcher indexes outside edits and commits them as `extern`; PDFs, scans and office files are extracted (poppler, tesseract, pandoc); Syncthing syncs to devices; mail attachments and task attachments are vault files; agents have `search_knowledge`, `read_document`, `write_note`, `list_folder`, `backlinks`. This package builds on that instead of replacing it.

## 1. Storage format: plain Markdown + frontmatter in the vault

| Option | License | Shape | Verdict |
|---|---|---|---|
| **Markdown + YAML frontmatter files (today)** | — | Files; any editor (Helena, desktop editors, agents' file tools) | **Keep.** Portable, diffable in git, agents work natively on files, no lock-in. |
| AFFiNE | Mixed: MIT, backend under an "Enterprise Edition" license (production use needs a subscription) | NestJS + Postgres + Redis, Yjs blocks in Postgres | Rejected: license, second service, block store instead of files. |
| Docmost | AGPL-3.0 core + enterprise folders | NestJS + Postgres + Redis + Hocuspocus; ProseMirror JSON + Yjs + tsvector in Postgres | Rejected: second app with its own users/ACL, DB is the truth. Its storage pattern (Yjs + JSON + text) informs §4. |
| SiYuan | AGPL-3.0 | Go kernel, `.sy` JSON block trees | Rejected: not Markdown files, second service. |
| Trilium (TriliumNext) | AGPL-3.0 | SQLite, CKEditor HTML | Rejected: not files. |
| Logseq | AGPL-3.0 | Desktop app; file graphs are Markdown, the new DB graphs are SQLite (beta) | Not a server. Its journals convention is supported as a client pattern. |
| AppFlowy | AGPL-3.0 client; self-host cloud archived 2026-09-11 for a commercial codebase | Flutter/Rust, CRDT | Rejected. |
| Outline | BUSL-1.1 | Postgres, Markdown export "lossy" | Excluded by license. |
| Anytype, Joplin Server | Source-available / personal-use | — | Excluded by license. |

Embedding any of these would add a second service, a second user/ACL model and a second truth; none is needed for what Helena lacks (a cross-tool index and capture). Desktop editors and Syncthing can use the same folder.

## 2. Links, graph and boards

- **Wikilinks** `[[Note]]`, `[[Note|alias]]`, `[[KEY-12]]` for tasks, Markdown links and URLs, parsed into `vault_link` (exists). Obsidian Flavored Markdown is the dialect (CommonMark + GFM + wikilinks/embeds).
- **Cross-tool links**: every knowledge item carries links (`knowledge_link`) in canonical targets: `task:VOL-12` (as people write it), `vault:<path>`, `<source>:<id>`, URL. Backlinks of a task therefore include notes, comments, mails, chats and runs that mention it.
- **Boards = JSON Canvas 1.0** (spec 2024-03-11, MIT, maintained by Obsidian; natively stored by Obsidian and Charkoal, importable by Kinopio, OrgPad and others). There is no maintained npm library with validation (`@trbn/jsoncanvas` is data types only, last release 2024), so Helena keeps a small zod schema of the spec. A board is a `.canvas` file in the project's vault folder: versioned in git, visible to agents and to Obsidian.

## 3. Search

| Option | License | Runs where | Verdict |
|---|---|---|---|
| **Postgres full text** (`tsvector`, `german` + `simple` configs, prefix queries) | PostgreSQL | in the database | **Base.** No extension, already used for the vault and mail. |
| **pgvector** 0.8.0-1 in Debian 13 (`postgresql-17-pgvector`, 255 kB download, 700 kB installed; 0.8.6 in PGDG) | PostgreSQL License | extension in the database | **Recommended for semantic search** (the standard; HNSW; `halfvec`). Not a trusted extension: `CREATE EXTENSION vector` needs a superuser once. **Owner OK needed.** |
| ParadeDB `pg_search` 0.25 | AGPL-3.0 | extension, `.deb` from GitHub (~68 MB), not in Debian | Rejected for now: BM25 is nicer than `ts_rank_cd`, but an out-of-Debian binary for a personal-scale index is not worth it. |
| VectorChord | AGPL-3.0 or ELv2 | extension, not packaged | Rejected (packaging). |
| Orama 3.1 | Apache-2.0 | in-process JS | Rejected: a second in-memory index next to Postgres, persistence by snapshots, ACL filtering would be ours. |
| LanceDB 0.39 | Apache-2.0 | embedded native binary (~200 MB) | Rejected: second store. |
| sqlite-vec 0.1 | MIT/Apache-2.0 | SQLite extension, pre-v1 | Rejected: second store, pre-v1. |
| Meilisearch 1.54 | MIT + BUSL (enterprise parts) | separate server | Rejected: extra service (§3b.3). |

**Hybrid ranking: Reciprocal Rank Fusion** (Cormack, Clarke, Büttcher, SIGIR 2009; the method pgvector's own hybrid-search example uses): score = Σ 1/(60 + rank) over the full-text list and the vector list. Implemented in `@helena/knowledge` (`searchKnowledgeIndex`), active for the vector list only when semantic search is on.

**Capability switch:** full text always works. Passages (`knowledge_chunk`) store embeddings as `real[]`, which needs no extension; with pgvector installed Helena adds an indexed `vector` column beside it at runtime (no migration depends on the extension, so a Helena without pgvector installs and upgrades cleanly).

## 4. Collaborative editing (humans and agents at once)

Standard stack: **Yjs 13.6** (MIT) + **TipTap 3 collaboration** (`@tiptap/extension-collaboration`, `-collaboration-caret`, `@tiptap/y-tiptap`, MIT; Helena's editor is TipTap 3.30 already) + **Hocuspocus 4.7** (MIT; v4 uses `crossws` and runs on Bun; no Redis for a single instance). Outline and Docmost both keep the Y.Doc binary, a ProseMirror JSON snapshot and text side by side; Markdown is a lossy export for them.

Decision for Helena, where the Markdown file is the truth:
- **Now:** optimistic concurrency, as built: every write names the sha256 it read (`expectedSha`), a stale write gets 409, the editor shows both versions to merge; Syncthing conflict copies are listed. Agents already write this way (`write_note`).
- **Next (not in this package):** live co-editing while a note is open: Hocuspocus inside the API process (a Bun `crossws` route), one Y.Doc per open note, created from the file (Markdown → ProseMirror JSON → Y.Doc with `@hocuspocus/transformer`), stored back to the file on idle (Y.Doc → ProseMirror → Markdown), `expectedSha` guarding against outside edits in between. An agent's `write_note` on an open note is applied to the Y.Doc as a diff (`updateYFragment`), so the person sees it live. Whether that diff preserves concurrent edits well is unverified; it needs a prototype before it replaces the 409 flow. No Y.Doc binaries in the vault; the file stays the truth.

## 5. Embeddings (semantic search)

| Option | Verdict |
|---|---|
| **Local, in-process: `@huggingface/transformers` 4.3 (Apache-2.0) with `onnxruntime-node` 1.30 (MIT, 301 MB unpacked npm package with CPU binaries)** in the worker | **Recommended.** No data leaves the machine, no API key, no model call in the sense of "KI-Arbeit" (it is indexing, like OCR). Bun support is claimed, with crash reports around `bun test` → smoke test before switching on. |
| Via Hermes / a provider API | Rejected as default: sends the whole vault, mail and chats to a provider; Helena would need a key; Hermes has no embedding interface. Kept possible behind the same `Embedder` interface. |
| None (full text only) | The state until the owner decides. |

Model candidates (all ONNX, all multilingual incl. German):

| Model | License | Params / dim / context | int8 ONNX |
|---|---|---|---|
| **ibm-granite/granite-embedding-97m-multilingual-r2** (2026-04-29) | Apache-2.0 | 97M / 384 / 32k | **98 MB** |
| ibm-granite/granite-embedding-311m-multilingual-r2 | Apache-2.0 | 311M / 768 (MRL) / 32k | 313 MB |
| intfloat/multilingual-e5-small | MIT | 118M / 384 / 512 | 118 MB |
| BAAI/bge-m3 | MIT | 568M / 1024 / 8k | 569 MB |
| Qwen3-Embedding-0.6B | Apache-2.0 | 596M / ≤1024 / 32k | 614 MB |
| google/embeddinggemma-300m | Gemma Terms (not OSI) | — | excluded |
| jina-embeddings-v3 | CC-BY-NC | — | excluded |

**Recommendation:** granite-embedding-97m-multilingual-r2, int8 (98 MB), 384 dimensions (fits pgvector's HNSW limit of 2,000 comfortably). Its retrieval score on IBM's card (60.3) is well above multilingual-e5-small (50.9) at a smaller size.

## 6. Agent access, provenance, approval

- **MCP tools** (Helena's MCP server is generated from API routes): `search_knowledge` becomes the one search over every source (tasks, docs, files, mail, chats, runs, comments) with `sources`, `project` and `folder` filters; every hit carries a `cite` Markdown link to the item in Helena. `read_knowledge` reads any hit by its ref. `read_document`, `write_note`, `list_folder`, `backlinks` stay.
- **Citations:** MCP 2026-07-28 has no citation mechanism; its building block is `resource_link` content. Helena returns stable links (the item's Helena URL) in structured results and asks agents (tool description + SOUL) to cite them as Markdown links. When the API's MCP layer moves to the v2 SDK, the same hits can be returned as `resource_link` blocks.
- **Provenance:** every vault write through Helena records who and which run: `vault_entry.last_author` (`user:<id>`, `agent:<id>`, `extern`), `last_run_id`, and **git trailers** (`Helena-Actor`, `Helena-Run`) on the commit, the standard place for machine-readable metadata in git. Items of other sources carry author/origin/run from their own rows.
- **Approval for agent writes:** the knowledge write tools declare MCP annotations (write, not destructive; trash is destructive), so the central policy engine of hub/autopilot (Cedar, action categories from MCP annotations) decides per level. No knowledge-specific approval path.

## 7. Capture, journal, resurfacing: patterns borrowed

- **Capture to an inbox** (GTD, Obsidian's web clipper, Logseq's journal): one action from every surface writes a Markdown note with the web clipper's properties (`title`, `source`, `created`, `tags`) into the project's `Inbox/` (Home/Inbox without a project). Registered as `@helena/sdk` capture targets (`inbox`, `journal`) so a plugin can add its own (for example a Zettelkasten folder).
- **Web page capture:** **Defuddle** 0.19 (MIT, by Obsidian's CEO, the extractor Obsidian's Web Clipper uses) on **linkedom** (ISC) with **turndown** (MIT) for Markdown, in-process. Rejected: Mozilla Readability 0.6 + turndown (older, Defuddle was built to replace it), jsdom (heavy).
- **Daily notes** (amended 2026-09-26): `Home/Docs/Journal/YYYY-MM-DD.md` from `Templates/Tagesnotiz` (`Templates/Daily note` on an English instance), Moment.js formats, template variables `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}`; the notes' "Journal: Today" opens the same file (their settings page names the folder). *History: until 2026-09-26 Helena seeded and read Obsidian's `.obsidian/daily-notes.json` and `templates.json`.* Quick captures go under the note's "Eingang" heading.
- **Templates:** Tagesnotiz, Meeting, Entscheidung (ADR-shaped: context, options, decision, consequences), Recherche, Projektbrief; English equivalents on an English instance.
- **Linking and resurfacing:** backlinks everywhere (task ↔ note ↔ mail ↔ chat ↔ run), "recent" in the empty search box; later: "on this day" in the daily note and related items by embedding similarity once semantic search is on.

## 8. Markdown parsing: marked outside the chat (orchestrator decision D-C6 left this to package K)

| Where | Parser | Why |
|---|---|---|
| Chat | Streamdown (unified/remark inside) | D-C6, streaming-safe; hub/chat-standards |
| Editor (Docs, stickers) | `@tiptap/markdown` (built on **marked**) | D-C6 / WEB-02, hub/standards-quickwins |
| Every other display (previews, task descriptions, file viewer, search snippets) | **marked** + DOMPurify | the same parser as the editor, so a note reads the same in the editor and in a preview; one place for Helena's extensions |
| Server (links, frontmatter) | the tested extractors in `@repo/vault` (`yaml` for frontmatter, a code-aware link scanner) | no AST needed today; if one is (block refs, embeds), `marked.lexer` rather than a second pipeline |

Decision: **marked everywhere outside the chat.** Obsidian syntax Helena understands (`[[wikilinks]]`, `![[embeds]]`, `==highlight==`, callouts) is written once as marked extensions and shared by the editor (`@tiptap/markdown` accepts marked tokenizers) and the display. Rejected: remark everywhere: it would mean a second parser beside the editor's marked (the editor cannot move to remark without leaving TipTap's official Markdown package), and the only remark user, Streamdown, keeps its own pipeline by design.

Backlog from the standards audit (§5.11): F22 (JSON Canvas boards) and DB-2 (one Postgres FTS search across sources) are this package; WEB-02 is coordinated (the editor's Markdown output must keep frontmatter and wikilinks byte-stable on round trips; the round-trip test in `packages/knowledge` covers the file side); F19 (one extraction module) is owned by hub/oss-packaging, and `@helena/knowledge` only reads the text `@repo/vault` extracted.

## 9. The framework shape

`@helena/knowledge` is the extension point's first user: the built-ins register through the `@helena/sdk` `KnowledgeSource` / `CaptureTarget` registries as the internal plugin `helena.knowledge`, exactly as an outside plugin would. SDK additions made here (additive): `KnowledgeScope.permission` (the role-matrix resource a reader needs), `KnowledgeItem.group` (collapse a thread into one result), `KnowledgeSource.present(ids)` (cheap sweep of deleted items).

One index table (`knowledge_item`) with one ACL model (project / team / private + permission) serves every source; the API computes each reader's reach from the same membership and role rules its routes check. The indexer runs in the worker (catch-up since the last run with an overlap, a sweep for deletions every two minutes); surfaces that know what they changed reindex those items at once. When the framework's event bus is live, `source.events` drives incremental indexing.

## Owner decisions

1. **pgvector** — `sudo apt install postgresql-17-pgvector` (Debian 13: 0.8.0-1, 255 kB download, 700 kB installed) and once `sudo -u postgres psql -d itsaplan -c 'CREATE EXTENSION vector'`. Without it semantic search still works on `real[]` passages (sequential scan, fine up to tens of thousands of passages); with it, an HNSW index.
2. **Embedding model** — `bun add @huggingface/transformers@4.3.0` in the worker (pulls `onnxruntime-node` 1.30, 301 MB unpacked, CPU binaries in the npm tarball) and a one-time download of `onnx-community/granite-embedding-97m-multilingual-r2-ONNX` int8 (98 MB) into the Helena data folder. Alternative: none (full text only).
