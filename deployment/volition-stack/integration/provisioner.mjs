import { ensureProjectGit } from "./project-git.mjs";
import {
  createProjectBrowserDeprovisioner,
  createProjectBrowserProvisioner,
  createProjectBrowserStatus,
} from "./project-browser.mjs";
import { provisionBoards } from "./boards.mjs";
import { presentAreas, provisionAreas, validAreas } from "./areas.mjs";
import { writeProjectContext } from "./project-context.mjs";
import {
  ensurePlanCoordinator,
  ensurePlanProjectAgent,
  projectAgentRuntimeName,
} from "./plan-coordinator.mjs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readJson, writeJsonAtomic } from "./atomic-json.mjs";
import { movePath } from "./move-path.mjs";

const execFileAsync = promisify(execFile);
const PROVISIONER_REVISION = 19;
const LEDGER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const VAULT_PROJECT_FOLDERS = ["Docs", "Files", "Assets", "Inbox"];

export class ProvisioningConflictError extends Error {}

function requestHash(envelope) {
  return crypto.createHash("sha256").update(JSON.stringify(envelope)).digest("hex");
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function projectSlug(projectKey) {
  return projectKey === "VERV" ? "verve" : projectKey.toLowerCase();
}

async function ensureDirectory(directory, mode = 0o750) {
  await fs.mkdir(directory, { recursive: true, mode });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("A provisioning path is not a regular directory");
  }
  return fs.realpath(directory);
}

async function ensurePrivateDirectory(directory) {
  const realPath = await ensureDirectory(directory, 0o700);
  await fs.chmod(realPath, 0o700);
  return realPath;
}

async function ensureSharedVaultDirectory(directory) {
  const realPath = await ensureDirectory(directory, 0o2770);
  const stat = await fs.stat(realPath);
  if ((stat.mode & 0o7777) !== 0o2770) await fs.chmod(realPath, 0o2770);
  return realPath;
}

async function existingDirectory(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("A configured project path is not a regular directory");
  }
  return fs.realpath(directory);
}

function workspaceUrl(config, containerPath) {
  if (!config.codeUrl) return undefined;
  const url = new URL(config.codeUrl);
  url.searchParams.set("folder", containerPath);
  return url.toString();
}

function terminalUrl(config, slug) {
  if (!config.terminalUrl) return undefined;
  const url = new URL(config.terminalUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${slug}`;
  url.search = "";
  return url.toString();
}

function resource(kind, id, url) {
  return url ? { kind, id, url } : { kind, id };
}

function registeredAgentIds(registry) {
  return (Array.isArray(registry?.agents) ? registry.agents : [])
    .map((agent) => agent?.id)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

function validBoards(boards) {
  return (Array.isArray(boards) ? boards : []).filter(
    (board) => board && Number.isSafeInteger(board.id) && board.id > 0,
  );
}

export function createProvisioner(config, options = {}) {
  const execute = options.execute ?? execFileAsync;
  const ensurePlanCoordinatorImpl = options.ensurePlanCoordinator ?? ensurePlanCoordinator;
  const ensurePlanProjectAgentImpl = options.ensurePlanProjectAgent ?? ensurePlanProjectAgent;
  const ensureProjectBrowser =
    options.ensureProjectBrowser ?? createProjectBrowserProvisioner(config, { execute });
  const deprovisionProjectBrowser =
    options.deprovisionProjectBrowser ??
    createProjectBrowserDeprovisioner(config, { execute, rename: options.rename });
  const projectBrowserActive =
    options.projectBrowserActive ?? createProjectBrowserStatus(config, { execute });
  const ensureFiles = options.ensureFiles ?? ensureProjectVault;
  const ensureBoardFiles =
    options.ensureBoardFiles ?? ensureLocalBoardFiles;
  let queue = Promise.resolve();

  // The runner reads the descriptors only when it starts.
  async function restartHermesRunner() {
    await execute(
      config.systemctlBin,
      [...(config.systemctlUser !== false ? ["--user"] : []), "restart", config.hermesRunnerService],
      { timeout: 60_000, maxBuffer: 64 * 1024, encoding: "utf8" },
    );
  }

  async function ensureProjectVault(_slug, project) {
    const vaultRoot = await ensureSharedVaultDirectory(config.vaultRoot);
    await Promise.all([
      ensureSharedVaultDirectory(path.join(vaultRoot, "Home")),
      ensureSharedVaultDirectory(path.join(vaultRoot, "Templates")),
    ]);
    const projectsRoot = await ensureSharedVaultDirectory(path.join(vaultRoot, "Projects"));
    const projectRoot = path.resolve(projectsRoot, project.key);
    if (!within(projectsRoot, projectRoot)) {
      throw new Error("The project vault path is invalid");
    }
    await ensureSharedVaultDirectory(projectRoot);
    await Promise.all(
      VAULT_PROJECT_FOLDERS.map((folder) => ensureSharedVaultDirectory(path.join(projectRoot, folder))),
    );
    return resource("files", projectRoot);
  }

  async function ensureLocalBoardFiles(slug, boardId, project) {
    const files = await ensureProjectVault(slug, project);
    const boardsRoot = await ensureSharedVaultDirectory(path.join(files.id, "Files", "Boards"));
    const boardRoot = path.join(boardsRoot, `board-${boardId}`);
    await ensureSharedVaultDirectory(boardRoot);
    return resource(`board:${boardId}:files`, boardRoot);
  }

  async function projectWorkspace(project) {
    const slug = projectSlug(project.key);
    const containerPath = path.join(config.workspaceRuntimeRoot ?? "/projects", slug);
    if (project.key === "VERV") {
      const realPath = await existingDirectory(config.verveProjectPath);
      if (path.normalize(realPath) !== path.normalize(config.verveProjectPath)) {
        throw new Error("The Verve project path resolves outside its configured directory");
      }
      return { slug, hostPath: realPath, containerPath, managed: false };
    }

    const root = await ensureDirectory(config.projectsRoot);
    const target = path.resolve(root, slug);
    if (!within(root, target)) throw new Error("The project workspace path is invalid");
    const hostPath = await ensureDirectory(target);
    if (!within(root, hostPath)) {
      throw new Error("The project workspace resolves outside its root");
    }
    return { slug, hostPath, containerPath, managed: true };
  }

  async function writeRegistry(envelope, workspace, coordinator, planCoordinator, agents, areas, files, terminal, browser) {
    const registryPath = path.join(config.registryRoot, `${workspace.slug}.json`);
    const current = await readJson(registryPath, null);
    if (current && current.project?.id !== envelope.project.id) {
      throw new ProvisioningConflictError("The project key belongs to another project id");
    }
    await writeJsonAtomic(registryPath, {
      schemaVersion: 1,
      project: envelope.project,
      slug: workspace.slug,
      requestedResources: envelope.requestedResources,
      boards: validBoards(envelope.boards),
      agents,
      areas,
      resources: {
        ...(current?.resources ?? {}),
        ...(workspace.hostPath
          ? {
              workspace: {
                hostPath: workspace.hostPath,
                containerPath: workspace.containerPath,
                managed: workspace.managed,
              },
            }
          : {}),
        ...(coordinator
          ? {
              coordinator: {
                id: coordinator.id,
                workspace: coordinator.workspace,
                hermesHome: coordinator.hermesHome,
                planAgentId: planCoordinator.planAgentId,
                planAgentUserId: planCoordinator.planAgentUserId,
                planUsername: planCoordinator.username,
                organization: planCoordinator.organization,
              },
            }
          : {}),
        ...(files
          ? { files: { path: files.id, ...(files.url ? { url: files.url } : {}) } }
          : {}),
        ...(terminal
          ? { terminal: { id: terminal.id, ...(terminal.url ? { url: terminal.url } : {}) } }
          : {}),
        ...(browser
          ? {
              browser: {
                id: browser.id,
                name: browser.name,
                profile: browser.profile,
                ...(browser.url ? { url: browser.url } : {}),
              },
            }
          : {}),
      },
      updatedAt: new Date().toISOString(),
    });
    return registryPath;
  }

  async function writeTrashReceipt(quarantineRoot, envelope, quarantined) {
    const receiptPath = path.join(quarantineRoot, "receipt.json");
    await writeJsonAtomic(receiptPath, {
      schemaVersion: 1,
      eventId: envelope.eventId,
      project: envelope.project,
      retentionDays: config.projectTrashRetentionDays,
      purgeAfter: new Date(
        Date.now() + config.projectTrashRetentionDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
      quarantined,
      completedAt: new Date().toISOString(),
    });
    return receiptPath;
  }

  // The registry lists the boards of the last successful run. A board missing from
  // this request was deleted in Plan, so its folders move to the trash.
  async function quarantineRemovedBoards(envelope, workspace) {
    const registry = await readJson(path.join(config.registryRoot, `${workspace.slug}.json`), null);
    if (registry?.project?.id !== envelope.project.id) return [];
    const kept = new Set(validBoards(envelope.boards).map((board) => board.id));
    const removed = validBoards(registry.boards).filter((board) => !kept.has(board.id));
    const quarantineRoot = path.join(config.projectTrashRoot, envelope.eventId);
    const boardFilesRoot = path.join(config.vaultRoot, "Projects", envelope.project.key, "Files", "Boards");
    const quarantined = [];
    for (const { id } of removed) {
      const name = `board-${id}`;
      const folders = [
        ...(workspace.hostPath ? [[path.join(workspace.hostPath, "boards"), "workspace"]] : []),
        [boardFilesRoot, "files"],
      ];
      for (const [root, kind] of folders) {
        const source = path.join(root, name);
        const exists = await fs.lstat(source).then(() => true, () => false);
        const moved = exists
          ? await quarantinePath({ source, allowedRoot: root, quarantineRoot, label: `${name}-${kind}` })
          : null;
        if (moved) quarantined.push(moved);
      }
    }
    return quarantined;
  }

  // The registry names the areas whose folders the last runs created, moved or found,
  // which is how a changed folder is moved and the folders of a deleted area are found.
  async function provisionProjectAreas(envelope, workspace, quarantineRoot) {
    const registryPath = path.join(config.registryRoot, `${workspace.slug}.json`);
    const registry = await readJson(registryPath, null);
    const registered = registry?.project?.id === envelope.project.id;
    const previous = registered ? validAreas(registry.areas) : [];
    const areas = envelope.areas ?? [];
    if (!areas.length && !previous.length) return { areas: [], quarantined: [], warnings: [] };
    const vault = await ensureProjectVault(workspace.slug, envelope.project);
    return provisionAreas({
      project: envelope.project,
      areas,
      previous,
      roots: [
        ...(workspace.hostPath
          ? [{ kind: "workspace", path: workspace.hostPath, ensure: ensureDirectory }]
          : []),
        { kind: "files", path: vault.id, ensure: ensureSharedVaultDirectory },
      ],
      quarantine: (source, allowedRoot, label) =>
        quarantinePath({ source, allowedRoot, quarantineRoot, label }),
      // A project's first run has no registry yet; writeRegistry creates it at the end.
      record: async (recorded) => {
        if (registered) await writeJsonAtomic(registryPath, { ...registry, areas: recorded });
      },
    });
  }

  // Removes the runtime of each agent of the project that is not in `keep`: the
  // descriptor is deleted because it holds the agent's API key, and the profile moves
  // to the trash. The registry names the agents of the last successful run, so a retry
  // still finds a profile an earlier attempt already moved. `runner.changed` is set as
  // soon as the running runner no longer matches the descriptors.
  async function removeAgentRuntimes(envelope, slug, keep, quarantineRoot, runner) {
    const registry = await readJson(path.join(config.registryRoot, `${slug}.json`), null);
    const profilesRoot = path.join(config.hermesHome, "profiles");
    const pattern = new RegExp(`^${slug}_([1-9][0-9]{0,9})(\\.json)?$`);
    const listed = async (directory) =>
      (await fs.readdir(directory).catch((error) => {
        if (error?.code === "ENOENT") return [];
        throw error;
      })).flatMap((name) => {
        const match = pattern.exec(name);
        return match ? [Number(match[1])] : [];
      });
    const ids = new Set([
      ...(registry?.project?.id === envelope.project.id ? registeredAgentIds(registry) : []),
      ...(await listed(config.hermesRunnerDescriptorRoot)),
      ...(await listed(profilesRoot)),
    ]);
    const quarantined = [];
    for (const id of [...ids].filter((candidate) => !keep.has(candidate)).sort((a, b) => a - b)) {
      const name = projectAgentRuntimeName(slug, id);
      await fs.unlink(path.join(config.hermesRunnerDescriptorRoot, `${name}.json`)).then(
        () => {
          runner.changed = true;
        },
        (error) => {
          if (error?.code !== "ENOENT") throw error;
        },
      );
      const profile = await quarantinePath({
        source: path.join(profilesRoot, name),
        allowedRoot: profilesRoot,
        quarantineRoot,
        label: `hermes-profile-${name}`,
      });
      if (profile) {
        runner.changed = true;
        quarantined.push(profile);
      }
    }
    return quarantined;
  }

  // Each agent in the request gets a Hermes profile and a runner descriptor of its own.
  // Plan issues their keys only against the control token; without it the runtimes are
  // left as they are.
  async function provisionAgentRuntimes(envelope, workspace, browser, quarantineRoot, runner) {
    if (!config.planControlToken) return { agents: [], quarantined: [] };
    const agents = [];
    for (const agentId of envelope.agents ?? []) {
      const runtime = await ensurePlanProjectAgentImpl(config, envelope.project, agentId, {
        workspace,
        browser,
      });
      if (runtime.descriptorChanged) runner.changed = true;
      await ensurePrivateDirectory(runtime.hermesHome);
      agents.push({ id: runtime.planAgentId, username: runtime.username, profile: runtime.name });
    }
    const keep = new Set(agents.map((agent) => agent.id));
    const quarantined = await removeAgentRuntimes(envelope, workspace.slug, keep, quarantineRoot, runner);
    return { agents, quarantined };
  }

  async function provisionResources(envelope) {
    const requested = new Set(envelope.requestedResources);
    const needsWorkspace =
      requested.has("workspace") ||
      requested.has("coordinator") ||
      requested.has("terminal") ||
      requested.has("browser") ||
      (envelope.boards?.length ?? 0) > 0 ||
      (envelope.agents?.length ?? 0) > 0 ||
      (envelope.areas?.length ?? 0) > 0;
    const workspace = needsWorkspace
      ? await projectWorkspace(envelope.project)
      : {
          slug: projectSlug(envelope.project.key),
          hostPath: "",
          containerPath: `/projects/${projectSlug(envelope.project.key)}`,
          managed: false,
        };
    if (needsWorkspace) await ensureProjectGit(workspace);

    const browser = requested.has("browser")
      ? await ensureProjectBrowser(envelope.project, workspace.slug)
      : null;
    const planCoordinator = requested.has("coordinator")
      ? await ensurePlanCoordinatorImpl(config, envelope.project, { workspace, browser })
      : null;
    const coordinator = planCoordinator
      ? {
          id: planCoordinator.username,
          workspace: workspace.hostPath,
          hermesHome: path.join(config.hermesHome, "profiles", workspace.slug),
        }
      : null;
    if (coordinator) {
      await ensurePrivateDirectory(coordinator.hermesHome);
      await writeProjectContext(
        config,
        envelope,
        coordinator,
        workspace,
        planCoordinator.organization?.projectInstructions ?? "",
      );
    }

    const quarantineRoot = path.join(config.projectTrashRoot, envelope.eventId);
    const runner = { changed: planCoordinator?.descriptorChanged === true };
    let agentRuntimes;
    try {
      agentRuntimes = await provisionAgentRuntimes(envelope, workspace, browser, quarantineRoot, runner);
    } finally {
      // A retry finds the descriptors this run already wrote unchanged, so a run that
      // fails here still loads them.
      if (runner.changed) await restartHermesRunner();
    }

    const files = requested.has("files")
      ? await ensureFiles(workspace.slug, envelope.project)
      : null;
    const terminal = requested.has("terminal")
      ? resource(
          "terminal",
          `terminal-project:${workspace.slug}`,
          terminalUrl(config, workspace.slug),
        )
      : null;
    const projectAreas = await provisionProjectAreas(envelope, workspace, quarantineRoot);
    const quarantined = [
      ...agentRuntimes.quarantined,
      ...projectAreas.quarantined,
      ...(await quarantineRemovedBoards(envelope, workspace)),
    ];
    if (quarantined.length) await writeTrashReceipt(quarantineRoot, envelope, quarantined);
    const boardResources = await provisionBoards(config, envelope, workspace, ensureBoardFiles);
    const registryPath = await writeRegistry(
      envelope,
      workspace,
      coordinator,
      planCoordinator,
      agentRuntimes.agents,
      projectAreas.areas,
      files,
      terminal,
      browser,
    );
    const resources = [resource("registry", `project:${workspace.slug}`), ...boardResources];
    if (needsWorkspace) {
      resources.unshift(
        resource(
          "workspace",
          workspace.containerPath,
          workspaceUrl(config, workspace.containerPath),
        ),
      );
    }
    if (coordinator) resources.push(resource("coordinator", coordinator.id));
    if (files) resources.push(files);
    if (terminal) resources.push(terminal);
    if (browser) resources.push(resource("browser", browser.id, browser.url));

    const warnings = [...projectAreas.warnings];
    if (!config.planControlToken && envelope.agents?.length) {
      warnings.push("Project agents get no Hermes runtime without the Plan control token.");
    }
    for (const kind of ["boards", "workflows"]) {
      if (requested.has(kind)) {
        warnings.push(
          `${kind} are managed inside It's a Plan and are not provisioned by this service.`,
        );
      }
    }
    return {
      resources,
      ...(warnings.length ? { warnings } : {}),
      registryPath,
    };
  }

  async function quarantinePath({ source, allowedRoot, quarantineRoot, label }) {
    const root = await ensureDirectory(allowedRoot);
    const candidate = path.resolve(source);
    if (!within(root, candidate)) throw new Error(`The ${label} path escapes its managed root`);
    const destination = path.resolve(quarantineRoot, label);
    if (!within(quarantineRoot, destination)) {
      throw new Error(`The ${label} quarantine path is invalid`);
    }
    let sourceStat;
    try {
      sourceStat = await fs.lstat(candidate);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    let destinationStat;
    try {
      destinationStat = await fs.lstat(destination);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (!sourceStat) {
      return destinationStat ? { label, destination, state: "quarantined" } : null;
    }
    if (sourceStat.isSymbolicLink()) throw new Error(`The ${label} path is a symbolic link`);
    if (destinationStat) throw new Error(`The ${label} quarantine destination already exists`);
    await ensurePrivateDirectory(quarantineRoot);
    await movePath(candidate, destination, { rename: options.rename });
    return { label, destination, state: "quarantined" };
  }

  async function deprovisionResources(envelope) {
    const slug = projectSlug(envelope.project.key);
    const quarantineRoot = path.join(config.projectTrashRoot, envelope.eventId);
    await ensurePrivateDirectory(quarantineRoot);
    const registryPath = path.join(config.registryRoot, `${slug}.json`);
    const registry = await readJson(registryPath, null);
    if (registry && registry.project?.id !== envelope.project.id) {
      throw new ProvisioningConflictError("The project registry belongs to another project id");
    }
    const quarantined = [];

    if (envelope.requestedResources.includes("browser") || registry?.resources?.browser) {
      const browserDestination = await deprovisionProjectBrowser(
        envelope.project,
        slug,
        quarantineRoot,
      );
      if (browserDestination) {
        quarantined.push({
          label: "browser",
          destination: browserDestination,
          state: "quarantined",
        });
      }
    }

    // The descriptor holds the coordinator's API key, so it is deleted rather than kept in the trash.
    const descriptorRemoved = await fs
      .unlink(path.join(config.hermesRunnerDescriptorRoot, `${slug}.json`))
      .then(
        () => true,
        (error) => {
          if (error?.code === "ENOENT") return false;
          throw error;
        },
      );
    const hermesAgent = await quarantinePath({
      source: path.join(config.hermesAgentsRoot, slug),
      allowedRoot: config.hermesAgentsRoot,
      quarantineRoot,
      label: "hermes-agent",
    });
    if (hermesAgent) quarantined.push(hermesAgent);
    const hermesProfile = await quarantinePath({
      source: path.join(config.hermesHome, "profiles", slug),
      allowedRoot: path.join(config.hermesHome, "profiles"),
      quarantineRoot,
      label: "hermes-profile",
    });
    if (hermesProfile) quarantined.push(hermesProfile);
    const runner = { changed: descriptorRemoved || Boolean(hermesAgent || hermesProfile) };
    quarantined.push(...(await removeAgentRuntimes(envelope, slug, new Set(), quarantineRoot, runner)));
    if (runner.changed) await restartHermesRunner();

    const workspaceManaged =
      registry?.resources?.workspace?.managed === true || envelope.project.key !== "VERV";
    if (workspaceManaged) {
      const workspace = await quarantinePath({
        source: path.join(config.projectsRoot, slug),
        allowedRoot: config.projectsRoot,
        quarantineRoot,
        label: "workspace",
      });
      if (workspace) quarantined.push(workspace);
    }
    const vault = await quarantinePath({
      source: path.join(config.vaultRoot, "Projects", envelope.project.key),
      allowedRoot: path.join(config.vaultRoot, "Projects"),
      quarantineRoot,
      label: "vault",
    });
    if (vault) quarantined.push(vault);
    const registryEntry = await quarantinePath({
      source: registryPath,
      allowedRoot: config.registryRoot,
      quarantineRoot,
      label: "registry.json",
    });
    if (registryEntry) quarantined.push(registryEntry);

    const receiptPath = await writeTrashReceipt(quarantineRoot, envelope, quarantined);
    const resources = quarantined.flatMap((item) => {
      const kind =
        item.label === "workspace"
          ? "workspace"
          : item.label === "vault"
            ? "files"
            : item.label === "browser"
              ? "browser"
              : item.label.startsWith("hermes")
                ? "coordinator"
                : null;
      return kind ? [resource(kind, `quarantine:${envelope.eventId}:${item.label}`)] : [];
    });
    return { resources, registryPath: receiptPath };
  }

  // What the registry says is provisioned, for the worker's reconciliation.
  async function provisionedState() {
    let names;
    try {
      names = await fs.readdir(config.registryRoot);
    } catch (error) {
      if (error?.code === "ENOENT") return { projects: [] };
      throw error;
    }
    const projects = [];
    for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
      const registry = await readJson(path.join(config.registryRoot, name), null);
      if (registry?.schemaVersion !== 1 || !Number.isSafeInteger(registry.project?.id)) continue;
      projects.push({
        project: registry.project,
        requestedResources: Array.isArray(registry.requestedResources)
          ? registry.requestedResources
          : [],
        boards: validBoards(registry.boards).map((board) => board.id),
        agents: registeredAgentIds(registry),
        areas: await presentAreas(registry.areas, [
          ...(registry.resources?.workspace?.hostPath ? [registry.resources.workspace.hostPath] : []),
          path.join(config.vaultRoot, "Projects", registry.project.key),
        ]),
        browserActive: registry.resources?.browser
          ? await projectBrowserActive(registry.slug)
          : null,
      });
    }
    return { projects };
  }

  async function provisionLocked(envelope) {
    const hash = requestHash(envelope);
    const ledger = await readJson(config.ledgerPath, {
      schemaVersion: 1,
      entries: {},
    });
    if (
      ledger.schemaVersion !== 1 ||
      !ledger.entries ||
      typeof ledger.entries !== "object"
    ) {
      throw new Error("The provisioning ledger has an unsupported format");
    }
    // The worker sends a new event id for every new run, so an old entry is never
    // needed again. Without an entry an event is simply run again.
    const cutoff = Date.now() - LEDGER_RETENTION_MS;
    for (const [eventId, entry] of Object.entries(ledger.entries)) {
      if (!(Date.parse(entry?.updatedAt) >= cutoff)) delete ledger.entries[eventId];
    }
    const existing = ledger.entries[envelope.eventId];
    if (existing?.requestHash !== undefined && existing.requestHash !== hash) {
      throw new ProvisioningConflictError(
        "The idempotency key was reused with another request",
      );
    }
    if (
      existing?.status === "succeeded" &&
      existing.provisionerRevision === PROVISIONER_REVISION
    ) {
      return existing.result;
    }

    ledger.entries[envelope.eventId] = {
      requestHash: hash,
      status: "processing",
      attempts: (existing?.attempts ?? 0) + 1,
      provisionerRevision: PROVISIONER_REVISION,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(config.ledgerPath, ledger);

    try {
      const provisioned =
        envelope.eventType === "project.deprovision"
          ? await deprovisionResources(envelope)
          : await provisionResources(envelope);
      const result = {
        resources: provisioned.resources,
        ...(provisioned.warnings ? { warnings: provisioned.warnings } : {}),
      };
      ledger.entries[envelope.eventId] = {
        ...ledger.entries[envelope.eventId],
        status: "succeeded",
        result,
        registryPath: provisioned.registryPath,
        updatedAt: new Date().toISOString(),
      };
      await writeJsonAtomic(config.ledgerPath, ledger);
      return result;
    } catch (error) {
      ledger.entries[envelope.eventId] = {
        ...ledger.entries[envelope.eventId],
        status: "failed",
        error:
          error instanceof ProvisioningConflictError ? "conflict" : "provisioning_failed",
        updatedAt: new Date().toISOString(),
      };
      await writeJsonAtomic(config.ledgerPath, ledger);
      throw error;
    }
  }

  return {
    state: provisionedState,
    provision(envelope) {
      const operation = queue.then(
        () => provisionLocked(envelope),
        () => provisionLocked(envelope),
      );
      queue = operation.catch(() => undefined);
      return operation;
    },
    deprovision(envelope) {
      const operation = queue.then(
        () => provisionLocked(envelope),
        () => provisionLocked(envelope),
      );
      queue = operation.catch(() => undefined);
      return operation;
    },
  };
}
