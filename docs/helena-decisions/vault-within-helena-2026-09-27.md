# Vault within Helena

The shared Markdown and file vault is the source of truth for Home and project Docs, Files, boards, agents and Syncthing devices. Helena indexes those files in Postgres; the index can be rebuilt from the vault. The native Docs editor and Files viewer edit the original bytes. A document path stays stable across the Home and project views.

## Editor and files

Markdown opens in Helena's formatted editor when its syntax can be preserved. Source mode is available for Markdown that the formatted editor cannot round trip. Text files use the plain text editor. Binary files remain available through the Files viewer. JSON Canvas boards use Helena's board view. The editor enforces file permissions, checks for concurrent changes and keeps the original vault path.

The vault watcher indexes external edits and Git commits them as `extern`. API writes record the user or agent that made the change. Syncthing remains the device sync path. The Private folder is separate from project access and from the main Git repository.

## Verification

The vault acceptance fixture in `deployment/volition-stack/native/vault-acceptance/` checks byte continuity across upload, native UI edit, agent edit, device edit, rename and restart. The UI acceptance is in `unified-vault-acceptance.md`. These checks use the same vault files throughout.
