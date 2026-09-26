# Files upload under the native SGID restriction

Root's seven-note upload into `RES/Docs/AI` failed before the first file write on live
`76380971`. Read-only inspection found zero entries, including temporary files, in that
directory. Its real parent directories existed with mode 2770 and API-user read/write/search
access; no immutable flag or read-only vault mount was present. API metadata shows
`RestrictSUIDSGID=yes`, `UMask=0007`, and the vault in `ReadWritePaths`.

The live `ensureDirectory` called `mkdir` with explicit mode 02770 on every component,
including the already existing `Projects` parent. The service's SGID syscall restriction
rejects that request with EPERM before mkdir can return EEXIST. A normal process with the
same Bun version returns EEXIST; a private systemd service with `RestrictSUIDSGID=yes`
reproduces the live EPERM using the unchanged live helper.

The fix checks existing directories without creating or chmodding them. New directories
request mode 0770 and inherit SGID from the vault parent; an already correct 2770 directory
needs no chmod. Existing normalization remains for environments where the inherited mode or
umask requires it. A missing SGID parent or incompatible restrictive configuration is not
repaired by relaxing permissions. The explicit folder-creation route uses the same helper.
Symlinks, file collisions and concurrent creation retain their existing checks.

Validation on the isolated source based on `76380971`:

- Private systemd user service, actual `RestrictSUIDSGID=yes`, `UMask=0007`, and
  `NoNewPrivileges=yes`: unchanged live helper fails EPERM; candidate writes seven synthetic
  notes, creates nested/shared folders with mode 2770, preserves parent UID/GID/mode,
  handles six concurrent creators, and rejects symlinks/files. Explicit SGID chmod still
  fails EPERM, proving the restriction stayed enabled.
- 20 Files integration/path tests, 92 assertions, passed. API TypeScript, scoped lint and
  changed-file formatting passed. All ran serially under `heavy.sh --class test`; private
  PG65501 is stopped.
- Native fixture is `apps/api/src/modules/project-files/__tests__/fixtures/sgid-runtime.ts`.
  Private commands/bundles/results are in `~/agent-work/files-existing-directory/`, including
  `checks.sh`, `native-old.log`, `native-current.log`, `tests.log`, and the three check logs.

No live directory, service policy, project state or original file was changed. Item 9's
prepared Files changes do not modify this helper. Root must integrate/review/gate the narrow
fix, then repeat the owner upload once and verify all seven canonical files in Helena and
through the authorized knowledge path. Do not change the protected parent permissions or
disable RestrictSUIDSGID. The seven owner notes remain unpublished until that acceptance.
