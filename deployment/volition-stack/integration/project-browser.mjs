import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-json.mjs";

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
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
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

function publicBrowserUrl(base, slug) {
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

export function createProjectBrowserProvisioner(config, options = {}) {
  const execute = options.execute;
  if (typeof execute !== "function") throw new Error("Project browser command runner is required");
  const probeCdp =
    options.probeCdp ??
    ((port) =>
      waitForProjectBrowserCdp(port, {
        fetchImpl: options.fetchImpl,
        delay: options.delay,
      }));

  return async function ensureProjectBrowser(project, slug) {
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
          (candidate) => !occupied.has(candidate) && !options.reservedSlots?.has(candidate),
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
  };
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
    await fs.rename(projectRoot, destination);
    return destination;
  };
}
