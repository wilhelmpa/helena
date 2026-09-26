# Item 11: family projects and personal access

Prepared in `codex/family-access`, based on reviewed R3 candidate `ee37f2e2`.
Deploy only after stabilization items 1–10, including the unified file workspace. This
preparation makes no live writes, creates no account and performs no login.

## Read-only metadata audit, 2026-09-26

ELLI (9), FAM (4) and PRIV (3) belong to team 1, department Familie & Privat, and use
Autopilot 3. Their project instructions exist; ELLI/FAM instructions name their split.
ELLI has one active goal and one paused goal; FAM has three active goals. ELLI has no
connected mailbox. FAM and PRIV each have one. No mail or document content was read.

Seven intended family agents are online, use memoryApproval=false and belong only to their
respective project. ELLI coordinator/assistant/finance are 49/68/69; FAM coordinator,
assistant, school/kita and baby specialists are 5/35/70/71. The FAM coordinator and assistant
lack a department assignment; the blueprint supplies it. Both family coordinators are
owner-scoped and therefore cannot accept Elli's requests yet. The FAM coordinator uses the
runtime default; the other six explicitly use gpt-6-luna. The assistant/finance source
templates still name claude-sonnet-5; blueprint copies explicitly use gpt-6-luna.

Only the instance owner exists as a human account. It owns all six projects. There is no
Elli account to alter or test. The team default member role grants project document, mail,
task and agent reads, but grants no integrations/credential management or agent editing.

## Prepared behavior

- LAN and kiosk default to personal authentication. Historical capability settings alone no
  longer sign everyone in as Patrick. Explicit compatibility single-user mode is denied by
  the API once a second human account exists, including inactive humans.
- A chooser lists up to four names previously authenticated in that browser. Selecting a name
  only fills the identifier; password/passkey/identity-provider proof is still required.
  Names can be forgotten. No session, key, role or token is stored with the names.
- Person wechseln signs out before opening the chooser. `login?switch=1` clears old auth
  cookies and suppresses automatic LAN, edge and OIDC bootstrap. A genuine existing personal
  session still opens Home directly. Cloudflare can be continued explicitly on its origin.
- Cloudflare SSO accepts active, existing verified human members on the explicit allowlist.
  It creates no account and changes no role or membership. Agent bot accounts are refused.
  Interactive tunnel requests with a different Helena-cookie identity return 401; logout is
  still possible. An extra API-key header cannot bypass the cookie identity check.
  API-key service traffic without browser cookies retains its separate authentication.
- Shared project membership cannot expose another person's owner-scoped agent, its runtime
  files or the Home master. A deleted owner does not transfer the agent to another person.
- Durable blueprints `personal-priv`, `personal-elli`, `family` keep personal capabilities
  equal and put school/kita/baby into FAM. Model and runner scope are explicit, reviewed
  blueprint changes. Family coordinators accept their project's members; Home stays owner-only.
  Two local specialist templates are included in the existing agent pool. No routine is
  introduced: existing native mail schedules and times stay intact; ELLI mail remains paused.

## Root integration and cutover

1. Integrate after items 1–10 and run the shared full gate on that combined commit. The new
   ACL tests complement item 9's file, Private, mail-original and raw-media guards.
2. Verify the owner's existing password or passkey works. Apply local-owner/configure.py
   `--personal` through normal ops, then revoke existing owner browser sessions before anyone
   else uses the LAN. Old automatic LAN sessions cannot be distinguished reliably; revoke
   all owner sessions, not passkeys/accounts/API keys. Announce this expected sign-in once.
3. Confirm API/web loaded personal mode, nginx syntax and all normal host guards. Visit local,
   public and kiosk entrances with no cookies: none may establish a Patrick session merely
   from network location or a saved name. Check automatic opening with a real personal session.
4. Import only the two missing local specialist templates (or the reviewed local pool); no
   remote skill download is needed. Root must bump the pool manifest version alongside its
   pending TypeSafe skill update; this branch intentionally leaves that shared manifest alone.
   Existing bespoke family specialists keep their IDs and
   memberships. Use the existing project-blueprint script in dry-run first for all three
   blueprint directories. Existing instructions and assignments are preserved and differences
   reported. Review planned goals against existing goals before applying the goals section;
   do not duplicate them. Applying the agents section sets intended model/scope and supplies
   missing departments/browser grants while preserving existing project-only membership.
5. After no runs or streaming chats remain, apply the reviewed profile/blueprint changes through
   the normal API/CLI. Verify seven agents online, runtime drift 0, project-only membership,
   memoryApproval=false, explicit gpt-6-luna and family coordinator member chat. No new schedule.

## Owner-only enrollment

- The owner invites Elli using her own address as team **member**, never manager/owner/god.
  Elli registers/authenticates herself and verifies her email. Accepting the first project
  invite joins the team; add the second project through its member list. Grant exactly ELLI
  and FAM as project member. Do not auto-join other projects or reuse Patrick's session.
- Elli or the owner establishes her password/passkey. Passkeys are hostname-bound: the current
  public RP ID does not automatically work on a different home hostname. Use a working own
  password at the home origin or the public hostname with split DNS and the matching RP ID.
- The owner adds her address to the Cloudflare Access application's allowed identities and
  Helena's explicit edge allowlist. The provider's authentication must be completed by Elli.
- Elli connects her own Google/mailbox herself and grants it only to ELLI. Keep its mail goal
  paused until connected and scoped. Preserve the accepted PRIV/FAM/VOL routines.

## Required actual two-person acceptance

Use separate browser profiles plus a shared-browser person-switch check. As Elli verify the
project list is exactly ELLI and FAM; their files/search, own chats, mail and Belege work.
PRIV/VOL/VERVE/TRADE, Private/Home documents, Home master, Patrick's owner-scoped agents,
owner terminal, owner credentials, private mail and private receipts must be inaccessible,
including direct URLs and search. Check an Elli→Patrick and Patrick→Elli switch with real
credentials: no old query cache or cookie identity survives as the other person. Check a
mixed Access assertion/cookie is rejected, own identity works, and deactivation stops access.
Actual sign-in and credential enrollment are unavailable to this worker and remain explicit
owner steps; do not mark Item 11 live-proven from synthetic fixtures alone.

## Preparation validation

Private database `itsaplan_family_test` on worker PostgreSQL port 55566; no live DB writes.
The focused API suite passed 144 tests across 11 files (agent ACL/chat/runtime files,
access logins, edge authentication and blueprint planning). The final additional API-key
header regression passed both edge suites: 20 tests. Web passed 23 tests, auth 16 and SDK
blueprints 4. API/web TypeScript checks and scoped ESLint passed; changed supported files
passed Prettier. Python: 2 personal-mode tests and 20 existing Cloudflare script tests,
with one platform skip on macOS for the existing Bash 4+ installer fingerprint test.

Mutation controls remove each important protection in the worker copy: personal-mode gate,
owner-agent visibility, and edge/cookie identity binding. Each made its regression test
fail; the original sources were restored immediately. These checks establish that the tests
actually detect the missing protection. Logs reside in `~/agent-work/family-access-tmp/`.
No dependency installation, account enrollment or UI login was performed. Integration must
still run the shared gate and the actual two-person acceptance above.
