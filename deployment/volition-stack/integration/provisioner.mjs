import { ensureProjectGit } from "./project-git.mjs";
import {
  createProjectBrowserDeprovisioner,
  createProjectBrowserProvisioner,
} from "./project-browser.mjs";
import { provisionBoards } from "./boards.mjs";
import { writeProjectContext } from "./project-context.mjs";
import { ensurePlanCoordinator } from "./plan-coordinator.mjs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readJson, writeJsonAtomic } from "./atomic-json.mjs";

const execFileAsync = promisify(execFile);
const PROVISIONER_REVISION = 17;
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

function mergeBoards(existing, incoming) {
  const merged = new Map();
  for (const board of [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ]) {
    if (board && Number.isSafeInteger(board.id) && board.id > 0) merged.set(board.id, board);
  }
  return [...merged.values()];
}

export function createProvisioner(config, options = {}) {
  const execute = options.execute ?? execFileAsync;
  const ensurePlanCoordinatorImpl = options.ensurePlanCoordinator ?? ensurePlanCoordinator;
  const ensureProjectBrowser =
    options.ensureProjectBrowser ?? createProjectBrowserProvisioner(config, { execute });
  const deprovisionProjectBrowser =
    options.deprovisionProjectBrowser ??
    createProjectBrowserDeprovisioner(config, { execute });
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

  async function writeRegistry(envelope, workspace, coordinator, planCoordinator, files, terminal, browser) {
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
      boards: mergeBoards(current?.boards, envelope.boards),
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

  async function provisionResources(envelope) {
    const requested = new Set(envelope.requestedResources);
    const needsWorkspace =
      requested.has("workspace") ||
      requested.has("coordinator") ||
      requested.has("terminal") ||
      requested.has("browser") ||
      (envelope.boards?.length ?? 0) > 0;
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
    if (planCoordinator?.descriptorChanged) await restartHermesRunner();
    const boardResources = await provisionBoards(config, envelope, workspace, ensureBoardFiles);
    const registryPath = await writeRegistry(envelope, workspace, coordinator, planCoordinator, files, terminal, browser);
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

    const warnings = [];
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
    await fs.rename(candidate, destination);
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

    const descriptor = await quarantinePath({
      source: path.join(config.hermesRunnerDescriptorRoot, `${slug}.json`),
      allowedRoot: config.hermesRunnerDescriptorRoot,
      quarantineRoot,
      label: "hermes-runner.json",
    });
    if (descriptor) quarantined.push(descriptor);
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
    if (descriptor || hermesAgent || hermesProfile) await restartHermesRunner();

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

    const receipt = {
      schemaVersion: 1,
      eventId: envelope.eventId,
      project: envelope.project,
      retentionDays: config.projectTrashRetentionDays,
      purgeAfter: new Date(
        Date.now() + config.projectTrashRetentionDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
      quarantined,
      completedAt: new Date().toISOString(),
    };
    const receiptPath = path.join(quarantineRoot, "receipt.json");
    await writeJsonAtomic(receiptPath, receipt);
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
