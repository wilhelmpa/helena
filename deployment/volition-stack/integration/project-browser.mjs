import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-json.mjs";
import { movePath } from "./move-path.mjs";

// A secret must be readable by its owner only. systemd's own credential directory is the
// exception: on a native boot it presents LoadCredential files as 0440 (0400 inside a
// container) and guards the directory itself, so group read is fine there.
function secretModeMask(file) {
  const dir = process.env.CREDENTIALS_DIRECTORY;
  return dir && file.startsWith(`${dir}/`) ? 0o037 : 0o077;
}

const PROJECT_SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_PROJECT_BROWSERS = 128;

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function privateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Project browser path is not a private directory");
  }
  await fs.chmod(directory, 0o700);
  return fs.realpath(directory);
}

async function privateFile(filePath) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & secretModeMask(filePath)) !== 0) {
    throw new Error("Project browser state is not a private regular file");
  }
}

async function atomicPrivateText(filePath, content) {
  const directory = path.dirname(filePath);
  await privateDirectory(directory);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, filePath);
  await fs.chmod(filePath, 0o600);
}

function checkedState(value, expectedSlug, expectedProjectId) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.slug !== expectedSlug ||
    value.projectId !== expectedProjectId ||
    !Number.isSafeInteger(value.slot) ||
    value.slot < 1 ||
    value.slot > MAX_PROJECT_BROWSERS
  ) {
    throw new Error("Project browser state conflicts with the project");
  }
  return value;
}

async function readState(filePath, fallback = null) {
  try {
    await privateFile(filePath);
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function endpoints(config, slot) {
  const display = config.projectBrowserDisplayBase + slot;
  const cdpPort = config.projectBrowserCdpPortBase + slot;
  const vncPort = config.projectBrowserVncPortBase + slot;
  const noVncPort = config.projectBrowserNoVncPortBase + slot;
  for (const value of [display, cdpPort, vncPort, noVncPort]) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error("Project browser endpoint allocation is invalid");
    }
  }
  if (new Set([cdpPort, vncPort, noVncPort]).size !== 3) {
    throw new Error("Project browser ports overlap");
  }
  return { display, cdpPort, vncPort, noVncPort };
}

async function usedSlots(root, currentSlug) {
  const slots = new Set();
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.name === currentSlug) continue;
    if (!entry.isDirectory() || !PROJECT_SLUG.test(entry.name)) continue;
    const state = await readState(path.join(root, entry.name, "runtime.json"));
    if (state && Number.isSafeInteger(state.slot) && state.slot >= 1 && state.slot <= MAX_PROJECT_BROWSERS) {
      slots.add(state.slot);
    }
  }
  return slots;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForProjectBrowserCdp(
  port,
  options = {},
) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return false;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const pause = options.delay ?? delay;
  const attempts = options.attempts ?? 20;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 1_000),
        headers: { accept: "application/json" },
      });
      if (response.ok) {
        const body = await response.json();
        const endpoint = new URL(body.webSocketDebuggerUrl);
        if (
          endpoint.protocol === "ws:" &&
          endpoint.hostname === "127.0.0.1" &&
          Number(endpoint.port) === port &&
          endpoint.pathname.startsWith("/devtools/browser/") &&
          !endpoint.username &&
          !endpoint.password
        ) {
          return true;
        }
      }
    } catch {
      // Startup is asynchronous; bounded retries handle the normal cold start.
    }
    if (attempt + 1 < attempts) await pause(options.delayMs ?? 250);
  }
  return false;
}

// The live view's address for a project; undefined while the base is a path that no
// request resolved yet (config.mjs withPublicOrigin).
export function publicBrowserUrl(base, slug) {
  if (!base || base.startsWith("/")) return undefined;
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/projects/${slug}/vnc.html`;
  url.search = "";
  url.searchParams.set("autoconnect", "1");
  url.searchParams.set("resize", "remote");
  url.searchParams.set("path", `${url.pathname.split("/projects/")[0].replace(/^\//, "")}/projects/${slug}/websockify`);
  return url.toString();
}

function unitNotInstalled(error) {
  const output = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
  return /not[- ]found|not loaded|could not be found|does not exist/i.test(output);
}

async function stopProjectBrowserUnits(config, execute, slug) {
  const systemctlPrefix = config.projectBrowserSystemctlUser !== false ? ["--user"] : [];
  const units = [
    `volition-project-browser@${slug}.target`,
    `volition-project-browser-chromium@${slug}.service`,
    `volition-project-browser-kasm@${slug}.service`,
  ];
  for (const unit of units) {
    try {
      await execute(config.systemctlBin, [...systemctlPrefix, "stop", unit], {
        timeout: 60_000,
        maxBuffer: 64 * 1024,
        encoding: "utf8",
      });
    } catch (error) {
      if (!unitNotInstalled(error)) throw error;
    }
  }
}

export function createProjectBrowserStatus(config, options = {}) {
  const execute = options.execute;
  if (typeof execute !== "function") throw new Error("Project browser command runner is required");

  return async function projectBrowserActive(slug) {
    if (!PROJECT_SLUG.test(slug)) return false;
    const systemctlPrefix = config.projectBrowserSystemctlUser !== false ? ["--user"] : [];
    try {
      const { stdout } = await execute(
        config.systemctlBin,
        [
          ...systemctlPrefix,
          "is-active",
          `volition-project-browser-kasm@${slug}.service`,
          `volition-project-browser-chromium@${slug}.service`,
        ],
        { timeout: 10_000, maxBuffer: 4_096, encoding: "utf8" },
      );
      return stdout.split("\n").filter(Boolean).every((line) => line.trim() === "active");
    } catch {
      // systemctl is-active exits non-zero when a unit is not active.
      return false;
    }
  };
}

// The files of a project's browser: its folders, its slot, its X authority and the unit
// environment. Written by whoever owns the browser state: the provisioning service, or with
// agent isolation the browser user (project-browser-state.mjs, started by the launcher).
export async function writeProjectBrowserState(config, execute, project, slug, reservedSlots) {
  if (!Number.isSafeInteger(project.id) || project.id < 1 || !PROJECT_SLUG.test(slug)) {
    throw new Error("Project browser identity is invalid");
  }
  const root = await privateDirectory(config.projectBrowserRoot);
    const projectRoot = path.resolve(root, slug);
    if (!inside(root, projectRoot)) throw new Error("Project browser path escapes its root");
    await privateDirectory(projectRoot);
    const statePath = path.join(projectRoot, "runtime.json");
    const existing = await readState(statePath);
    const slot = existing ? checkedState(existing, slug, project.id).slot : null;
    const occupied = await usedSlots(root, slug);
    if (slot != null && occupied.has(slot)) {
      throw new Error("Project browser slot conflicts with another project");
    }
    const selectedSlot = slot ?? Array.from({ length: MAX_PROJECT_BROWSERS }, (_, index) => index + 1).find(
          (candidate) => !occupied.has(candidate) && !reservedSlots?.has(candidate),
        );
    if (!selectedSlot) throw new Error("No project browser slots are available");
    const endpoint = endpoints(config, selectedSlot);

    const directories = Object.fromEntries(
      await Promise.all(
        ["profile", "cache", "home", "run", "run/runtime", "run/tmp"].map(async (name) => [
          name,
          await privateDirectory(path.join(projectRoot, name)),
        ]),
      ),
    );
    const xauthority = path.join(projectRoot, "run", "Xauthority");
    try {
      await privateFile(xauthority);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const cookieResult = await execute(config.mcookieBin, [], {
        timeout: 5_000,
        maxBuffer: 4_096,
        encoding: "utf8",
      });
      const cookie = cookieResult.stdout.trim();
      if (!/^[a-f0-9]{32}$/i.test(cookie)) throw new Error("Xauthority cookie generation failed");
      const commandPath = path.join(
        projectRoot,
        "run",
        `.xauth.${process.pid}.${crypto.randomUUID()}.command`,
      );
      await atomicPrivateText(commandPath, `add :${endpoint.display} . ${cookie}\n`);
      try {
        await execute(
          config.xauthBin,
          ["-f", xauthority, "source", commandPath],
          { timeout: 5_000, maxBuffer: 4_096, encoding: "utf8" },
        );
      } finally {
        await fs.rm(commandPath, { force: true });
      }
      await privateFile(xauthority);
    }

    const state = {
      schemaVersion: 1,
      projectId: project.id,
      slug,
      slot: selectedSlot,
      ...endpoint,
    };
    await writeJsonAtomic(statePath, state);
    await fs.chmod(statePath, 0o600);
    const environment = [
      `PROJECT_BROWSER_SLUG=${slug}`,
      `PROJECT_BROWSER_DISPLAY=:${endpoint.display}`,
      `PROJECT_BROWSER_CDP_PORT=${endpoint.cdpPort}`,
      `PROJECT_BROWSER_VNC_PORT=${endpoint.vncPort}`,
      `PROJECT_BROWSER_NOVNC_PORT=${endpoint.noVncPort}`,
      `PROJECT_BROWSER_ROOT=${projectRoot}`,
      `PROJECT_BROWSER_PROFILE=${directories.profile}`,
      `PROJECT_BROWSER_CACHE=${directories.cache}`,
      `PROJECT_BROWSER_HOME=${directories.home}`,
      `PROJECT_BROWSER_RUN=${directories.run}`,
      `PROJECT_BROWSER_XAUTHORITY=${xauthority}`,
      `DISPLAY=:${endpoint.display}`,
      `XAUTHORITY=${xauthority}`,
      `HOME=${directories.home}`,
      `XDG_RUNTIME_DIR=${directories["run/runtime"]}`,
      `TMPDIR=${directories["run/tmp"]}`,
      "",
    ].join("\n");
    await atomicPrivateText(path.join(projectRoot, "runtime.env"), environment);
    return state;
}

async function startProjectBrowser(config, execute, probeCdp, project, slug, state) {
    const endpoint = state;
    const kasmUnit = `volition-project-browser-kasm@${slug}.service`;
    const chromiumUnit = `volition-project-browser-chromium@${slug}.service`;
    const systemctlPrefix = config.projectBrowserSystemctlUser !== false ? ["--user"] : [];
    await execute(config.systemctlBin, [...systemctlPrefix, "start", kasmUnit, chromiumUnit], {
      timeout: 60_000,
      maxBuffer: 64 * 1024,
      encoding: "utf8",
    });
    if (!(await probeCdp(endpoint.cdpPort))) {
      await execute(config.systemctlBin, [...systemctlPrefix, "restart", kasmUnit, chromiumUnit], {
        timeout: 60_000,
        maxBuffer: 64 * 1024,
        encoding: "utf8",
      });
      if (!(await probeCdp(endpoint.cdpPort))) {
        throw new Error("Project browser CDP health check failed after restart");
      }
    }

    return {
      id: `project-browser:${slug}`,
      name: "project-browser",
      profile: `project:${project.id}:${slug}`,
      cdpUrl: `http://127.0.0.1:${endpoint.cdpPort}`,
      url: publicBrowserUrl(config.projectBrowserPublicUrl, slug),
    };
}

function cdpProbe(options) {
  return (
    options.probeCdp ??
    ((port) =>
      waitForProjectBrowserCdp(port, {
        fetchImpl: options.fetchImpl,
        delay: options.delay,
      }))
  );
}

export function createProjectBrowserProvisioner(config, options = {}) {
  const execute = options.execute;
  if (typeof execute !== "function") throw new Error("Project browser command runner is required");
  const probeCdp = cdpProbe(options);
  return async function ensureProjectBrowser(project, slug) {
    const state = await writeProjectBrowserState(config, execute, project, slug, options.reservedSlots);
    return startProjectBrowser(config, execute, probeCdp, project, slug, state);
  };
}

// With agent isolation the browser state belongs to the browser user, so the launcher writes
// it as that user; the units are started as before.
export function createIsolatedProjectBrowserProvisioner(config, options = {}) {
  const execute = options.execute;
  const launcher = options.launcher;
  if (typeof execute !== "function" || !launcher) {
    throw new Error("Project browser command runner and launcher are required");
  }
  const probeCdp = cdpProbe(options);
  return async function ensureProjectBrowser(project, slug) {
    if (!Number.isSafeInteger(project.id) || project.id < 1 || !PROJECT_SLUG.test(slug)) {
      throw new Error("Project browser identity is invalid");
    }
    const answer = await launcher.browserState("ensure", slug, project.id);
    const state = answer?.state;
    if (!state || state.slug !== slug || state.projectId !== project.id) {
      throw new Error("Project browser state conflicts with the project");
    }
    return startProjectBrowser(config, execute, probeCdp, project, slug, endpoints(config, state.slot));
  };
}

export function createIsolatedProjectBrowserDeprovisioner(config, options = {}) {
  const execute = options.execute;
  const launcher = options.launcher;
  if (typeof execute !== "function" || !launcher) {
    throw new Error("Project browser command runner and launcher are required");
  }
  return async function deprovisionProjectBrowser(project, slug, quarantineRoot) {
    if (!Number.isSafeInteger(project.id) || project.id < 1 || !PROJECT_SLUG.test(slug)) {
      throw new Error("Project browser identity is invalid");
    }
    await stopProjectBrowserUnits(config, execute, slug);
    const eventId = path.basename(quarantineRoot);
    const answer = await launcher.browserState("remove", slug, project.id, eventId);
    return answer?.destination ?? null;
  };
}

// The browser state's own trash: the browser user keeps what it removed, apart from the
// provisioning trash it cannot write to.
export async function moveProjectBrowserState(config, project, slug, trashRoot, eventId, options = {}) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(eventId)) throw new Error("Project browser trash name is invalid");
  const root = await privateDirectory(config.projectBrowserRoot);
  const projectRoot = path.resolve(root, slug);
  if (!inside(root, projectRoot)) throw new Error("Project browser path escapes its root");
  const trash = await privateDirectory(trashRoot);
  const quarantineRoot = path.resolve(trash, eventId);
  if (!inside(trash, quarantineRoot)) throw new Error("Project browser trash path is invalid");
  const destination = path.join(quarantineRoot, slug);
  let sourceState = null;
  try {
    sourceState = await readState(path.join(projectRoot, "runtime.json"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!sourceState) {
    const moved = await fs.lstat(destination).then(() => true, () => false);
    return moved ? destination : null;
  }
  checkedState(sourceState, slug, project.id);
  await privateDirectory(quarantineRoot);
  await movePath(projectRoot, destination, { rename: options.rename });
  // The trash purge (purge-trash.mjs) deletes it once its time is up, like the project's own.
  const retentionDays = options.retentionDays ?? 30;
  await writeJsonAtomic(path.join(quarantineRoot, "receipt.json"), {
    schemaVersion: 1,
    eventId,
    project: { id: project.id, slug },
    retentionDays,
    purgeAfter: new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString(),
    quarantined: [{ label: "browser", destination, state: "quarantined" }],
    completedAt: new Date().toISOString(),
  });
  return destination;
}

export function createProjectBrowserDeprovisioner(config, options = {}) {
  const execute = options.execute;
  if (typeof execute !== "function") throw new Error("Project browser command runner is required");

  return async function deprovisionProjectBrowser(project, slug, quarantineRoot) {
    if (!Number.isSafeInteger(project.id) || project.id < 1 || !PROJECT_SLUG.test(slug)) {
      throw new Error("Project browser identity is invalid");
    }
    const root = await privateDirectory(config.projectBrowserRoot);
    const projectRoot = path.resolve(root, slug);
    if (!inside(root, projectRoot)) throw new Error("Project browser path escapes its root");
    const destination = path.resolve(quarantineRoot, "browser");
    if (!inside(quarantineRoot, destination)) {
      throw new Error("Project browser quarantine path is invalid");
    }

    let sourceState;
    try {
      sourceState = await readState(path.join(projectRoot, "runtime.json"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (!sourceState) {
      let destinationState = null;
      try {
        destinationState = await readState(path.join(destination, "runtime.json"));
        if (destinationState) checkedState(destinationState, slug, project.id);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await stopProjectBrowserUnits(config, execute, slug);
      return destinationState ? destination : null;
    }
    checkedState(sourceState, slug, project.id);
    await stopProjectBrowserUnits(config, execute, slug);
    await privateDirectory(quarantineRoot);
    try {
      await fs.lstat(destination);
      throw new Error("Project browser quarantine destination already exists");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await movePath(projectRoot, destination, { rename: options.rename });
    return destination;
  };
}
