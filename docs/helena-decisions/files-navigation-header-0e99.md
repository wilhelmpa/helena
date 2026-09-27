# Stable Files navigation after Vault0e99

Prepared from `0e99cd6e40b1505fe067eb5b8cb05749a88805ab`; no server work or deployment.

The Files page previously placed Knowledge/Boards/Code inside FileToolbar for file views,
but directly in the page body for Boards. NoteBoardBar separately occupied the header
portal. Switching to Boards therefore moved the common navigation below the header.

The composed Boards view now receives that same navigation through a small shared context
and places it first inside its existing PageToolbar. The single-row Shell header, phone
page bar and classic 48px toolbar continue to use their existing layout and responsive
collapse. NoteBoardTabs is only extracted to its own file to meet the one-component rule;
its behavior is unchanged. No extra toolbar, menu, route or storage is added.

This applies to every project Files page, including the Home project's page. The global
`/files` browser has its own Home/Private/Templates/project-root selector and no Boards/Code
view tabs; its existing toolbar is unchanged. The existing short `Wissen` / `Knowledge` labels stay unchanged. Documents remain
reachable through the existing `Docs` folder, without renaming it or changing any path. Permissions, Vault containment and native Markdown handling stay
unchanged.

A focused DOM regression exercises the real ProjectFilesPage, NoteBoardBar, PageToolbar,
PageTabs and ShellHeaderRow. Only data-bound children/hooks are fixtures. It switches all
three views with a desktop header slot and a narrow phone slot, checks that navigation
stays in that slot, checks the compact dropdown, retains the exact Boards URL and checks
that denied Boards access hides the choice. The unchanged0e99 page fails at the misplaced
Boards navigation; the prepared page passes. JSDOM does not measure real browser pixels:
Root's screenshot geometry and actual mobile/desktop acceptance remain required.

Local checks (existing dependencies, from `apps/web`):

```sh
bun test --preserve-symlinks --preload ./test/setup.ts --isolate src/features/project-files/ProjectFilesPage.test.tsx src/features/project-files/components/VaultMarkdownBoundary.test.tsx src/features/project-files/utils/editMarkdownSource.test.ts src/utils/vaultLinks.test.ts
bun ../../node_modules/typescript/bin/tsc --noEmit --preserveSymlinks -p tsconfig.json
NODE_OPTIONS='--preserve-symlinks --preserve-symlinks-main' node ../../node_modules/eslint/bin/eslint.js src/context/pageToolbarNavigation.tsx src/features/project-files/ProjectFilesPage.tsx src/features/project-files/ProjectFilesPage.test.tsx src/features/notes/components/NoteBoardBar.tsx src/features/notes/components/NoteBoardTabs.tsx
```

Root acceptance: at the same viewport, switch Knowledge → Boards → Code → Knowledge in a project (and Home project where available), compare tab/header rectangles (Root measured y55.5→108, a52.5px jump before the fix),
open an existing `Docs` file, and repeat at narrow width via the existing dropdown. No
folder rename, content write or permission change is part of this patch.
