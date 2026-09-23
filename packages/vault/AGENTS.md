# @repo/vault

The knowledge vault (`PROJECT_VAULT_ROOT`, live `/srv/volition/vault`): Markdown notes and
other files that Plan's Docs, Obsidian (through Syncthing) and the agents all work on. The
files are the source of truth. This package holds what the api and the worker share: path
rules, Markdown parsing, the index in Postgres, the git history and text extraction. It uses
Bun APIs and `@repo/db`; the runner does not import it.

## Layout

```
Home/            Home's Docs (Home/Docs) and whatever the owner keeps there
Projects/<KEY>/  Docs, Files, Assets, Inbox and the area folders of a project
Templates/
Private/         the owner's; group volition-private, never readable by an agent
.trash/          Obsidian's trash; a trashed path keeps its relative path below it
.obsidian/       Obsidian's settings (hub/obsidian-sync)
```

`deployment/volition-stack/native/vault-setup.sh` creates the top level, the groups, the
permissions and the git repositories; the provisioning service creates the project folders.

## Rules

- **The files are the truth, the index is derived.** `vault_entry`, `vault_link` and
  `vault_move` (`packages/db/src/schema/vault.ts`) can be truncated at any time; the
  watcher's next rescan rebuilds them.
- **One writer of the index per change.** The api indexes and commits what it writes itself
  (`indexVaultPaths`, `commitVaultPaths`); the worker's watcher (`startVaultWatcher`)
  indexes everything else and commits it as `extern` once the vault is quiet. A change the
  api made reaches the watcher as well and is found unchanged by its sha256.
- **A move is the same sha256 leaving one path and appearing at another** in one batch of
  changes (or one rescan). The row moves with it, keeping its id, its links and its
  extracted text, and `vault_move` records it for `resolveVaultPath`.
- **Text only in git.** `isVersioned` and the `.gitignore` the setup script writes agree:
  md, canvas, txt, csv, json, yaml; not the trash, not Syncthing's conflict copies, not
  `.obsidian/workspace*`. `Private/` is a repository of its own.
- **Extraction is queued.** A binary file is indexed as `pending`; the watcher extracts it
  with poppler, tesseract (deu+eng) and pandoc, and reads xlsx and pptx itself. A missing
  program marks the entry `unavailable` with the programs it needs; the rescan queues it
  again once they are installed. Limits are in `EXTRACTION_LIMITS`.
- **Syncthing conflict copies** (`*.sync-conflict-*`) are not indexed; `listSyncConflicts`
  lists them with the file they belong to.
- **Never follow a link.** File operations refuse symbolic links on the way to a path.

## Tests

`bun test` (loads `.env.test`, uses the test database's vault tables and temporary vault
roots). The extraction tests build their fixtures with poppler and pandoc and skip where
those are missing; the git tests skip without git.
