#!/usr/bin/env node
// The browser state of one project, written as the browser user: started by the agent
// launcher (deployment/volition-stack/isolation) when agents are isolated, because then the
// provisioning service may no longer open the browser profiles.
//
//   project-browser-state.mjs ensure <slug> <projectId>
//   project-browser-state.mjs remove <slug> <projectId> <eventId>
//
// Prints one JSON line: { state } or { destination }.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { moveProjectBrowserState, writeProjectBrowserState } from "./project-browser.mjs";

const run = promisify(execFile);

function base(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) throw new Error(`${name} is invalid`);
  return value;
}

function absolute(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value.startsWith("/")) throw new Error(`${name} must be absolute`);
  return value;
}

const config = {
  projectBrowserRoot: absolute("PROJECT_BROWSER_ROOT", "/var/lib/volition/project-browser/projects"),
  projectBrowserTrashRoot: absolute("PROJECT_BROWSER_TRASH_ROOT", "/var/lib/volition/project-browser/trash"),
  projectBrowserDisplayBase: base("PROJECT_BROWSER_DISPLAY_BASE", 200),
  projectBrowserCdpPortBase: base("PROJECT_BROWSER_CDP_PORT_BASE", 19200),
  projectBrowserVncPortBase: base("PROJECT_BROWSER_VNC_PORT_BASE", 15900),
  projectBrowserNoVncPortBase: base("PROJECT_BROWSER_NOVNC_PORT_BASE", 16080),
  mcookieBin: absolute("MCOOKIE_BIN", "/usr/bin/mcookie"),
  xauthBin: absolute("XAUTH_BIN", "/usr/bin/xauth"),
};

async function main(argv) {
  const [action, slug, projectIdText, eventId] = argv;
  const project = { id: Number(projectIdText) };
  if (action === "ensure" && argv.length === 3) {
    const state = await writeProjectBrowserState(config, run, project, slug);
    return { state };
  }
  if (action === "remove" && argv.length === 4) {
    const destination = await moveProjectBrowserState(
      config,
      project,
      slug,
      config.projectBrowserTrashRoot,
      eventId,
      { retentionDays: base("PROJECT_TRASH_RETENTION_DAYS", 30) },
    );
    return { destination };
  }
  throw new Error("usage: project-browser-state.mjs ensure <slug> <projectId> | remove <slug> <projectId> <eventId>");
}

main(process.argv.slice(2)).then(
  (answer) => process.stdout.write(`${JSON.stringify(answer)}\n`),
  (error) => {
    process.stderr.write(`project-browser-state: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
