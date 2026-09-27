# Unified Vault: synthetic root acceptance

Prepared from `072fb36f`. This is a runbook, not a live result. Complete point 9 in the
documented release order. Root alone deploys, runs UI actions and restarts services.
Use existing authenticated sessions and authorized agents; never export their keys/cookies.
No real document is needed. Do not mark the item complete from the file hashes alone.

Private validation on 2026-09-26, after the Browser/MFA deployment window: 43 API tests /
291 assertions across chat-workspace, unified-vault, files and mail-receipt-moves passed.
API and Vault TypeScript, scoped lint/format and `git diff --check` passed. R2 independently
approved both source fixes. Four local Python tests cover the complete fixture cycle,
overwrite/duplicate refusal, symlinks/nonregular/oversize files and manifest/path tampering.
The synthetic PDF/PNG formats were recognized locally. Kingston used only
`~/agent-work/vault-acceptance`, private PG65503, reused dependencies and `heavy.sh`;
the private server stopped on completion. No live request, real document or provider was used.

## Source audit

| Requirement | Existing implementation / regression |
| --- | --- |
| One menu | `SidebarWorkNav` selects Files or its Boards tab; `panelTools` makes the separate notes tool unavailable. Project/Home Files use `FileBrowser` and `UnifiedFileViewer`. |
| Old links | `/docs?path=...`, project `/docs?path=...`, `/notes/<boardId>` redirect to Files; `vaultNotePath` retains project, folder, selected file and canvas. |
| Same bytes | `project-files/service.ts`, `attachments/project-vault.ts`, `chat-attachments` and initiative attachments use the canonical vault; `link_attachment` creates a reference without copying. |
| Agent paths | `read_document`, `write_note`, `search_knowledge`, `upload_chat_attachment`, `read_chat_attachment` and `link_attachment` are existing MCP routes. The API integration `unified-vault.test.ts` exercises the actual `/mcp` JSON output. |
| Access | Project guards plus `knowledge/scope.ts`; Private is excluded from agents and SilverBullet. `references.ts` filters task access and own conversations separately from file access. Chat selection must use the same vault scope. |
| Changes and rename | ETag/sha conflict checks, `moveEntries`/`vault_move`, project-bound attachment references and watcher indexing. Include Home/project-chat file metadata in rename coverage. |
| Shared vault | All normal file/note use stays in Helena. Native editor and agent tools share the original vault bytes. The existing isolated SilverBullet service is retained, but its frontend and domain are not a release prerequisite; full frontend parity remains open. |
| Migration | Journal `0189` defaults → `0190` mail triage Claim → `0191` paper intents → `0192` unified Vault; snapshot `0192.prevId = 0191.id`. `attachments-to-vault.ts` keeps legacy objects for rollback. |

Before the shared gate, include the two narrow review fixes: chat attachment selection must
deny unauthorized Home files while preserving authorized Templates, and renames must retain
own-chat references without rewriting message text. Run the affected API regressions, the
existing unified-vault/files/mail-receipt-moves tests, vault tests and normal release checks.
Do not run any of these against production. No tests were run against a database during the
browser/MFA gate for this preparation.

## Preflight and deterministic fixtures

1. Record deployed/source SHA and migration state through existing ops tools. Verify the SQL
   and snapshot chain above. Take the normal DB/vault backup. Review the existing attachment
   migration dry-run, apply it separately and retain its restricted receipt, then repeat the
   dry-run. Pending and failed counts must reach zero or have an explicit unresolved list.
   This synthetic proof does not migrate existing data or prove legacy conversion quality.
2. Pick a permitted project (examples below use `VOL`) and a fresh run id. Retain only the
   fixture folder, generated artifact and one synthetic task/chat for this proof. Create the
   task as an ordinary human-owned task with no agent delegate or automation trigger.
3. Prepare uploads on the Mac with the committed Python stdlib helper. It has no network,
   imports no Helena modules and writes only a new local review directory. It refuses an
   existing directory. Do not hand-edit its manifest.

```sh
PROJECT=VOL
RUN=vaultproof-$(python3 -c 'import secrets; print(secrets.token_hex(6))')
WORK=/Users/wilhelmpa/volition/vault-acceptance-$RUN
python3 deployment/volition-stack/native/vault-acceptance/fixtures.py prepare \
  --work "$WORK" --project "$PROJECT" --run "$RUN"
```

The returned folder is `Projects/VOL/Files/<RUN>`. `upload/` contains an original Markdown,
valid tiny PDF and PNG. `expected/` contains exact UTF-8/LF content for each edit and the agent
artifact. All local files are 0600, directories 0700. Review and stage this single manifest
plus expected files and helper through root's existing copy/checksum procedure to a private
server directory, e.g. `/var/lib/helena-proof/vault/<RUN>`. No login or package install is
part of this procedure. Keep the local uploads for the UI file picker.

Root defines `PROOF` as the staged script and `REVIEW` as that canonical private directory.
The following command is read-only, only opens the manifest's four deterministic file paths,
rejects symlinks/nonregular files/oversize data and never prints file contents:

```sh
python3 "$PROOF" verify --work "$REVIEW" --vault /srv/volition/vault --stage absent
```

It must report `success:true`. Do not reuse a proof folder. A failure is a stop condition;
do not delete or overwrite the conflicting folder. Save command exits, JSON results and UI
evidence in the private review record. Runtime diagnostics must not include env, tokens,
ordinary document bodies or complete database rows.

## One cycle, through the actual UI and tools

Use CUA for browser interaction, including visible viewer contents and read-only inspection
of synthetic responses. Do not use shell CDP on the production browser. File operations in
the steps below are native Helena actions; the Python helper never writes to the vault.

| Step | Action and exact expected evidence |
| --- | --- |
| Navigation | In Home and VOL count exactly one **Dateien** entry. There is no separate Dokumente/Notizen entry. Boards remains a tab. Verify old saved `/project/VOL/docs?path=Projects%2FVOL%2FFiles%2F<RUN>%2FCycle.md` opens the same selected file after the upload, and an existing authorized `/notes/<id>` preserves its board. Do not alter that board. |
| Upload | In VOL → Dateien → Wissen → Files create `<RUN>`. Upload exactly the three local `upload/` files through the picker. Open PDF and PNG; both must render their original type inside Helena. Run `verify ... --stage upload`. It checks all three paths, raw bytes and hashes and rejects a numbered duplicate. |
| UI edit | Open `Cycle.md` directly in the Helena editor, replace its entire contents with `expected/ui.md`, save. Run `verify ... --stage ui`. Record the Files text response ETag and knowledge response sha256; compare both to the same current raw bytes, accounting for the ETag's quoting. A stale save must return 409 and retain the draft (use the private regression rather than altering another user's file). |
| Ticket | Link `Cycle.md` and `original.pdf` to the synthetic task via **Mit Aufgabe verknüpfen**. Record task id/identifier, attachment publicIds and canonical `vaultPath`. From the task preview use **Im Ordner anzeigen**; it must select that file in Dateien. Raw attachment SHA256 must equal the Files raw SHA256, with `linked=true`; no second live file appears. |
| Agent read/write | In a fresh authorized project-agent chat, attach the existing `Cycle.md` using the file picker. Ask it to use `read_document` on the full manifest path, then `write_note` with the returned `expectedSha` and exact `expected/agent.md` content. It also creates the exact `Agent-artifact.md` in the same proof folder via `write_note`, with `expected/Agent-artifact.md` content. No terminal file copy, new store, email, web fetch or unrelated tool is needed. Verify actual tool calls/results, not the assistant's assertion. Run `verify ... --stage agent`. |
| Agent artifact | Use existing `link_attachment` with the synthetic task id and project-relative `Files/<RUN>/Agent-artifact.md`. `read_document`/`search_knowledge` must find this unique marker, and the result must point at the full canonical path. Verify `vault_entry.last_author` identifies the agent; record run id only if the genuine call carries one. Chat-only actions need not have a run id. |
| Second native edit | In the same Helena file viewer append exactly `Stage: silverbullet` plus LF to match the **unchanged historical fixture bytes** in `expected/silverbullet.md`; this marker/stage name is not evidence of SilverBullet execution. Verify raw bytes with `verify ... --stage silverbullet`, reopen the native editor and call agent `read_document` again. Confirm search and the actual user provenance, not `notes` provenance. The real SilverBullet frontend edit/watch cycle is explicitly deferred, not passed. |
| Rename | In Dateien rename only `Cycle.md` to `Renamed.md`. Run `verify ... --stage renamed`; the old active path must be absent. Follow the previously saved Docs link and old chat attachment link: both must resolve to the renamed file. Task attachment publicIds remain stable, their current paths change. The renamed file's References must still show the reader's project/Home chats and synthetic task. Message text and other-project file references remain unchanged. |
| Reopen | Close and reopen the workspace; reload Helena. Files, PDF/PNG, note and artifact remain reachable and editable. Run `verify ... --stage restart` as a persistence checkpoint before any restart. |
| Restart | In root's normal no-in-flight maintenance window, restart only the services required by the release (API/worker when relevant), not Chromium/profiles or models. Reopen the same saved links and repeat raw/agent/search reads. Run `verify ... --stage restart` again. A successful pre-restart check is not restart proof. |

The agent should use this exact payload shape, with values from the manifest and previously
read response. The request must run through its ordinary authenticated native/MCP path:

```json
{"name":"read_document","arguments":{"path":"Projects/VOL/Files/<RUN>/Cycle.md"}}
{"name":"write_note","arguments":{"path":"Projects/VOL/Files/<RUN>/Cycle.md","expectedSha":"<sha256 just read>","content":"<exact expected/agent.md bytes>"}}
{"name":"write_note","arguments":{"path":"Projects/VOL/Files/<RUN>/Agent-artifact.md","content":"<exact expected/Agent-artifact.md bytes>"}}
{"name":"link_attachment","arguments":{"issueId":123,"path":"Files/<RUN>/Agent-artifact.md"}}
{"name":"search_knowledge","arguments":{"q":"<RUN>"}}
```

Do not fabricate an API receipt by setting an agent id on a direct filesystem write. If an
agent changes whitespace, the byte proof fails: inspect the synthetic delta and ask for the
exact requested content; never edit the manifest to turn a mismatch into a pass.

## Independent access and origin checks

- Use an existing agent without VOL document access to request only these synthetic paths
  through `read_document`, `search_knowledge` and the authenticated raw attachment URL.
  Expect deny/no hit, never the marker, bytes, task title or own-chat title. A same filename
  under its own project must not redirect into VOL. The shared integration tests also check
  plain outsiders and documents-only readers. If no existing live restricted actor is usable,
  record that live step as open; do not create a person's account or pretend Owner tested denial.
- A documents-only reader cannot see the synthetic task title without task access and cannot
  see another user's chat title. A non-owner may use the native file editor under the existing
  project permissions, but must not receive the whole-vault SilverBullet UI/auth grant.
- A normal project member cannot attach the owner's Home note through a chat. Authorized
  template reading remains available; Private paths and hidden paths stay denied to agents.
- On the actual Helena hostname, verify Markdown opens directly in the native editor and
  no Notes-domain iframe or separate Notes action is offered. Legacy runtime mappings and
  saved Notes panels must not re-enable it. Do not create a DNS/Cloudflare route or relax the
  existing same-origin/frame guard. The stock SilverBullet frontend's own origin/auth/CSP
  and external-editor cycle are deferred, not release checks passed by this native UI.

## Narrow metadata proof and retention

The helper also generates `metadata.sql` with explicit columns and only the five exact
original/renamed fixture paths. On the Mac, use the existing read-only wrapper:

```sh
/Users/wilhelmpa/volition/tools/ksql.sh "$WORK/metadata.sql"
```

Keep the exit status and restricted result. No `-w` flag is needed. Record:

- `vault_entry`: id, path, sha256, size_bytes, last_author, last_run_id, extraction_status;
- `issue_attachment` joined to the synthetic issue: id/public_id, vault_path, sha256,
  linked and `s3_key IS NULL` (never its value);
- `chat_attachment`, if that upload tool was exercised: public_id, project_id, vault_path,
  sha256 and `s3_key IS NULL`;
- `vault_move`: from_path/to_path for this run only; verify the old path resolves after edit;
- `agent_chat_message`: only fixture message ids/thread ids and the `kind=file` path fields;
  no text, prompts, profiles or other conversations. The stored attachment sha256 can be the
  ingestion hash after an edit; current original/response/index hashes are the byte evidence.

The helper checks the entire small proof folder for unexpected names; it does not scan ordinary
vault files. An original plus its text extraction/index is one store. Trashed edit versions and
retained legacy migration objects are intentional recovery data, not competing active originals.

Retain the manifest, hashes, task/attachment/chat ids and observed URLs with the root evidence.
After acceptance, archive the synthetic task/chat through existing UI and move only the exact
manifest folder to Helena's trash; do not delete history, migration objects, shared templates
or unrelated files. Record the archive/trash destinations. This helper intentionally has no
live cleanup or restart operation. A failed proof remains retained for diagnosis until Root
chooses this same scoped archival cleanup. Final completion requires all observed UI/tool/
native UI/ACL/restart checks above; report separately any owner-only or unavailable step.
