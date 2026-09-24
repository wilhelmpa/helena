# hub/helena-design — handover to the next agent

Written 2026-09-23 at the end of the Sonnet build pass, for the Opus agent taking over
design quality (owner feedback: inconsistent typography, elements that look clickable but
are not). Last commit at handover: **`de4484d5`**, pushed, clean (typecheck incl. root
`tsc --noEmit`, format, lint all green; see "Validating" below). Branch `hub/helena-design`,
origin `wilhelmpa@kingston-server.local:/srv/volition/source/plan`. Working copy
`/Users/wilhelmpa/agent-clones/helena-design`; Kingston test folder `~/agent-work/plan-design`
(private Postgres on port 55483, scripts `plan-design-setup.sh`/`plan-design-test.sh`).

Reference doc: `docs/volition-design-helena-ui.md` on the Mac (the design brief this whole
branch implements). CLAUDE.md's "Naming rule" section covers the rename.

## What is done

**Phase 1 (rename to Helena):** complete. `APP_NAME` in `apps/web/src/utils/app.ts` is the
one source of truth; all 10 locales, manifest/favicon (new `HelenaMark`/`HelenaWordmark` in
`components/brand/`), mail templates, README/NOTICE, a new About section in
Settings → General. `scripts/no-itsaplan-strings.test.ts` (part of `bun test scripts/`)
guards against regressions — an explicit allowlist for the AGPL attribution surfaces, fails
on anything new. Internal identifiers (DB `itsaplan`, `@itsaplan/runner`, chart, paths, the
Syncthing/Obsidian vault folder literally named "Volition") deliberately untouched — see the
naming rule for why. Full detail in the commit `bba45378` and the report already in this
conversation's history (not reproduced here).

**Phase 2 (tokens/building blocks):** `--status-running/-waiting/-success/-danger/-idle` and
`--brand-subtle` in `apps/web/src/app/globals.css` (light+dark). New components in
`apps/web/src/components/common/page/`: `PageBody`, `UnsavedChangesBar` (the floating save
bar), `StatusBadge`, `AgentAvatar`, `EntityCard`, `ProjectSettingsNav`. `PageHeader`,
`SettingsSection`/`SettingsCard`/`SettingsRow`, `EmptyState` already existed from an earlier
branch (unchanged). Spacing scale documented as a comment in `globals.css` next to the color
tokens (page gutter `p-4`, section spacing `gap-4`/`space-y-4`, card padding `p-4`, row
height `h-8`) — deliberately not new CSS variables, spacing doesn't change between themes.

**Single-row header (owner decision 2026-09-23, mid-branch):** new account preference
`headerLayout` (`'single'` default | `'classic'`, DB migration **`0162`** — see "Migration
numbering" below). In `'single'`: language/theme/account move from `AppHeader` into a new
`SidebarUtilityRow` in the sidebar footer (both `AppSidebar` and `GodSidebar` — `AppSidebar`
had no brand footer at all before this, now it has one like `GodSidebar` always did); a
page's own view-tabs/filter bar merges into `AppHeader`'s one row via a new hook,
`useShellHeaderExtra` (`apps/web/src/hooks/useShellHeaderExtra.ts`), instead of rendering as
its own second row. `'classic'` is byte-for-byte the pre-existing two-row behavior — nothing
in that path changed. Wired into: the main board (`WorkItemsPage`), `CycleIssuesBoard`,
`InitiativeIssuesBoard`, `InboxPage` (see "Known stumbling blocks" — this one needed a real
fix, not a plain copy-paste of the pattern). **Not yet wired**: any other page with its own
tab/filter row — I did not do an exhaustive search beyond the ones named in the design doc
and the ones I happened to touch; grep for `WORKSPACE_HEADER_CLASS` usage outside
`components/layout/` and `useShellHeaderExtra` usage to find what is left.

**Consistency pass (owner: "sieht noch nicht konsistent aus"):**
- `PageHeader` swapped in for ad hoc `<h1>` blocks on: `OrganizationPage`,
  `HomeAgentActivityPage`, `HomeRoutinesPage`, `ApprovalsPage`, `HomeTasksPage`. There are
  more `<h1>` matches in `apps/web/src/features/**` I did not get to (auth screens,
  `HomePipelinesPage`'s empty state, issue-detail internals) — some of those are
  legitimately not page chrome (an issue title, an auth card), so check each rather than
  blanket-replacing.
- `components/ui/dialog.tsx`, `sheet.tsx`: padding/gap onto the 4px scale, title
  18px→16px. Fixed at the primitive so every usage in `features/**` (~14 Dialog, ~6 Sheet)
  picked it up in one commit (`3458a07d`). `dropdown-menu.tsx`/`popover.tsx` were already on
  the scale (`min-h-8`, `p-4`), untouched.
- `components/ui/card.tsx`: same scale, and the shadow removed (design doc: only floating
  elements get a shadow). Only 2 callers in `features/**` use this primitive directly — most
  of the app's "cards" are ad hoc `bg-card/border/rounded` divs, which is arguably the real
  inconsistency here. `EntityCard` is the intended convergence point; reconciling the many ad
  hoc card divs with it is not done.
- Raw status colors (`amber-500`, `emerald-500`, `red-500`, `green-500`, …) moved onto the
  `--status-*` tokens in ~15 files across organization/routines/settings/teams/board (commits
  `d2c9c7ca`, `9877e059`, and the `AgentRuntimeConflicts` fix in the i18n-sweep commit).

**Board:** column header gets the state's own color as a 3px top border (inline style —
`group.color` is user-configured content, not a token, like the notes sticker palette), the
WIP counter sits in a pill. **Not done:** an agent-running indicator on the card itself — no
existing data field says "an agent is working on this issue right now" (only
`assigneeUserId`), building that needs either a new aggregation or a live subscription in the
virtualized card list; did not attempt inside that hot path without being able to see it run.

**Issue detail:** already two-column before this branch (`IssueDetailContent.tsx`, layout
`'split'`/`'page'`, resizable Properties sidebar, container-query responsive collapse). Not
rebuilt, just confirmed it already matches the design doc's ask.

**Project settings:** `apps/web/src/app/project/[projectKey]/settings/layout.tsx` +
`ProjectSettingsShell` wrap every settings page in a second, narrow, grouped nav column
(`useProjectSettingsNavGroups`: Projekt/Arbeit/Agenten & Automatisierung/Integrationen — the
doc's fifth group, Gefahrenzone, is not a nav destination, see below). Simplification made
under time pressure: Members/Notifications/MCP-Server stay routes *outside* `/settings/*`
(moving live `page.tsx` files into a route group felt riskier than this pass should take), so
navigating to them from the settings nav leaves this shell — a real gap if consistency is the
goal, worth fixing properly with more time. `SettingsGeneralPage` demonstrates the intended
end state: `UnsavedChangesBar` instead of a header Save button, and a new `ProjectDangerZone`
(red-bordered, type-the-key confirm, reuses `TeamProjectDeleteDialog`/its mutation rather than
a second delete implementation). **The other 9 project settings pages are not migrated.**
Triage already done, save real time: `IssueTypes/Labels/CustomFields/IssueTemplates/Actions/
Webhooks/Git` are list-management pages using `SettingsHeaderAddButton` — that pattern is
already correct, no save bar needed there. Only `SettingsConfigurationPage` is a genuine old
save-button-in-header case (three combined form hooks —
`useSubtaskAutomationForm`/`useEstimatesForm`/`useAutoArchiveForm` — none currently expose a
`dirty` flag; adding one to each and combining them is the work). **Global settings**
(`/god/*`) not touched at all — `GodShell`/`GodSidebar` already have their own dedicated
navigation (arguably already satisfies the doc's intent structurally, just as a full sidebar
rather than an in-page column); whether that's "close enough" or needs the same in-page
treatment is a judgment call for whoever picks this up.

**Home:** greeting + date, KPI row (open tasks / pending approvals / running agents), "Braucht
dich" (approvals + workflow gates + recently failed runs) beside "Agenten gerade" (live
activity read). Built entirely from existing, already-correct endpoints
(`apps/web/src/features/home/services/homeKpis.service.ts`) rather than a new aggregation —
"running agents" is a documented approximation (reads the recent activity feed, not a true
live count; see the module comment). "Heute erledigt" from the design doc is not built: a
correct cross-project count needs each project's own configured "done" state, which varies —
did not want to ship an approximate/wrong number for that one.

**Panel density:** the tool panel's own header (chat/terminal/code/browser/mail) is now 40px
(`WORKSPACE_PANEL_HEADER_CLASS` in `components/layout/WorkspaceHeader.tsx`) instead of the
48px page-header height, with its own test in `WorkspaceHeader.test.tsx`. **Not done:** the
issue-detail panel, and a broader pass over individual Dialog/Sheet *content* (the primitive
fix helps padding/title size everywhere, but does not touch what each dialog actually puts
inside — some may still set their own larger text or looser spacing).

## Known stumbling blocks

**The lint ratchet, not a pass/fail gate.** `apps/web/eslint.config.mjs` has three
`no-restricted-syntax` rules (raw hex/rgb, raw Tailwind palette classes, arbitrary
`text-`/`h-`/`size-`/`leading-[Npx]`) at **`warn`**, not `error` — `bun run lint` is a hard
gate other branches merge behind, and these rules found a real, large pre-existing backlog
that failing the build on would have blocked everyone. The actual enforcement is
`apps/web/src/design/lintRatchet.test.ts` (runs `eslint . --format json` itself, sums the
`no-restricted-syntax` warnings, fails only if the count goes **above** `BASELINE`, currently
**203**, last verified at 201 after this branch's own cleanups — headroom, not drift).
**When you fix files, lower BASELINE to match** (grep the eslint JSON output's `filePath`s to
see what changed) — that is what makes the ratchet mean something instead of just being a
number. Raising it needs a reason in the commit. Two deliberate scope narrowings versus the
design doc's literal wording, both explained in comments at the point of decision: the
arbitrary-size rule only covers `text-`/`h-`/`size-`/`leading-` (not `max-w-`/`min-w-`, which
are legitimate per-field truncation widths, not a type-scale violation), and there is
**no lint rule for spacing** yet (measured: `p-6`/`p-8`/`gap-6`/`gap-8`/… appear 250+ times
across 158 files, all ordinary pre-existing Tailwind spacing — a rule that starts red on 158
files is worse than no rule).

**Radix `Tabs` split across `useShellHeaderExtra`.** If a page's tab switcher (not its
filter bar — an *actual* `<TabsList>`/`<TabsTrigger>`/`<TabsContent>` from
`components/ui/tabs.tsx`) needs to move into the header slot, a plain copy-paste breaks: the
switcher (rendered into `AppHeader`, via `Shell`'s state) and the content it drives (rendered
in the page body) end up in two different subtrees — siblings of `AppHeader`, not
descendants of it, since `useShellHeaderExtra` is state lifted into `Shell`, not a DOM portal
into the same tree. One Radix `Tabs.Root`'s context cannot reach both halves; a click in the
header would not switch the content below. Fixed in `InboxPage.tsx` (commit `a655ac2a`) by
lifting the active tab into plain `useState` and pointing **two independent, controlled**
`<Tabs>` instances at it (one holding only `TabsList`, one holding only `TabsContent`) so a
click in either calls the same `onValueChange`. If you find another page with this exact
shape, this is the pattern — do not skip it thinking a quick copy of the ViewTabs/FilterBar
approach is enough; those two never had this problem because they are plain controlled
components, not Radix `Tabs`.

**Migration numbering.** The `headerLayout` preference's migration is **`0162`**
(`packages/db/drizzle/0162_header-layout-preference.sql`), not 0160 — it was originally
generated as 0160, then `origin/volition/hub` landed `0160_chat_workspace` and
`0161_run_resume` ahead of it, so it was renumbered per CLAUDE.md's migration-clash
procedure (commit `1ebdc719`: took theirs for the journal/snapshot, deleted the incoming SQL,
regenerated via `drizzle-kit generate` in `packages/db`, confirmed a second generate says "No
schema changes"). If you merge `origin/volition/hub` again and it has moved further, watch
for the same clash pattern in `packages/db/drizzle/meta/_journal.json` and
`meta/0160_snapshot.json` (or whatever the next colliding number is).

**Kingston stale-checkout gotcha (workflow note, not a code issue).** Running
`bunx prettier --write` directly on `~/agent-work/plan-design` on Kingston to compute a
formatting diff (rather than running prettier locally) leaves that checkout dirty; the next
`git fetch && git checkout -B` from there fails with "your local changes would be
overwritten" until you `git checkout -- <file>` first. Happened repeatedly this session.
Prefer running Prettier's diff-and-apply on the Mac clone directly if you have Node/bun there;
otherwise remember to clean up immediately after.

**Chat area untouched, on purpose.** `features/ai-chat/components/workspace/` (and
`components/panel/NativeChatWorkspace.tsx`, which that directory imports) was explicitly
off-limits per the coordinator while `hub/chat-fix` was still being built in parallel. Check
`git log origin/volition/hub --oneline | grep chat-fix` before touching anything there — if
it has landed, the whole area (fonts/spacing/dialogs inside chat, and the originally-flagged
`ChatPanelModelSettings.tsx` i18n task, which no longer exists as a file — superseded by
`ChatModelPicker.tsx`/`ChatReasoningDisclosure.tsx`) is fair game and was never actually
looked at for tokens/spacing consistency. Two pre-existing test failures live there right
now, unrelated to this branch (`ChatClarificationCard.test.tsx`, a React 19 / jsdom
`KeyboardEvent` dispatch error, reproducible, not caused by anything in this branch — flagged,
not fixed, per the "don't touch" instruction).

**No jsdom/testing-library rendering for apps/web.** Web tests here are logic-level
(`bun:test` for `apps/api`, but `node:test`/`node:assert` for `apps/web` — see any existing
`*.test.ts` for the pattern; `bun:test`/`import.meta.dir` do not typecheck under `apps/web`'s
`tsconfig.json`, caught this the hard way in commit `d28c1883`). There is no way to assert
"this renders with the right font size" short of an actual browser. The owner's specific
complaint (inconsistent typography, dead-looking clickable elements) needs eyes on the
running app, not more unit tests — screenshots or a live walkthrough are the way to verify a
fix here, not `bun test`.

## Validating a change (Kingston, `~/agent-work/plan-design`)

```
git fetch -q /srv/volition/source/plan hub/helena-design:refs/remotes/src/hub/helena-design
git checkout -q -B hub/helena-design refs/remotes/src/hub/helena-design
bun install
bun run typecheck && bunx tsc --noEmit   # per-package, then the root check
bun run format:check
bun run lint                              # 0 errors expected; warnings are the ratchet's job
bun test scripts/no-itsaplan-strings.test.ts
cd apps/web && bun test --preload ./test/setup.ts   # 1 known flaky (ApprovalDecisionForm) + 2 known chat failures
```
For `apps/api`, migrate first (`BACKUP_DIR=$W/tmp bun --env-file=.env.test packages/db/src/migrate.ts`),
then `cd apps/api && bun test --env-file=../../.env.test`. Known baseline: 17–18 failures,
none touching anything this branch changed (verified twice this session, same 17 test names
before and after the `hub/chat`/`hub/run-resume` merge).

## Suggested next steps, roughly in order

1. Typography audit in the running app (the owner's actual complaint) — probably the highest
   priority: find where `text-lg`/`text-xl`/ad hoc sizes still diverge from the 12/13/14/16/
   20/24/30 scale outside `components/ui`/`components/common`.
2. "Elements that look clickable but are not" — likely hover states or cursor styles on
   non-interactive elements styled like buttons/links; needs visual inspection, not grep.
3. Finish the header/tabs sweep (item above, more pages likely have their own second row).
4. `SettingsConfigurationPage` save-bar migration (add `dirty` to its three form hooks).
5. Reconcile ad hoc card divs onto `EntityCard`/`Card`.
6. Global settings (`/god/*`) — decide whether `GodSidebar` alone is "done" or needs the
   in-page nav column too.
7. Once `hub/chat-fix` lands: the whole `features/ai-chat/components/workspace/` tree, never
   audited for tokens/spacing/typography.
8. Lower the lint ratchet `BASELINE` as files get fixed along the way.
