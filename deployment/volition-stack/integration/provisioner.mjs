import { ensureProjectGit } from "./project-git.mjs";
import {
  ensureInternalReadAccess,
  ensureKarrCareerStateAccess,
} from "./integration-tools.mjs";
import { provisionBoards } from "./boards.mjs";
import { writeProjectContext } from "./project-context.mjs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readJson, writeJsonAtomic } from "./atomic-json.mjs";
import { createNextcloudClient } from "./nextcloud.mjs";
import {
  activeTeamAgentIds,
  applyCoordinatorPolicy,
  reconcileTeamDelegation,
} from "./coordinator-policy.mjs";
import { ensurePlanCoordinator } from "./plan-coordinator.mjs";

const execFileAsync = promisify(execFile);
const PROVISIONER_REVISION = 13;
const BROWSER_WIDGET_NAME = "volition-browser";

export class ProvisioningConflictError extends Error {}

function requestHash(envelope) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(envelope))
    .digest("hex");
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
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

function coordinatorUrl(config, agentId) {
  if (!config.openClawUrl) return undefined;
  const url = new URL(config.openClawUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/${encodeURIComponent(agentId)}`;
  return url.toString();
}

function browserUrl(config, agentId) {
  if (!config.openClawUrl) return undefined;
  const url = new URL(config.openClawUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/focus/dashboard/${encodeURIComponent(agentId)}`;
  return url.toString();
}

function terminalUrl(config, slug) {
  if (!config.openClawUrl) return undefined;
  const url = new URL(config.openClawUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/focus/terminal-project/`;
  url.searchParams.set("arg", slug);
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
    if (board && Number.isSafeInteger(board.id) && board.id > 0) {
      merged.set(board.id, board);
    }
  }
  return [...merged.values()];
}

export function createProvisioner(config, options = {}) {
  const execute = options.execute ?? execFileAsync;
  const nextcloud = createNextcloudClient(config, options);
  const ensureFiles = options.ensureFiles ?? ((slug) => nextcloud.ensureProjectFolder(slug));
  const ensureBoardFiles = options.ensureBoardFiles ?? ((slug, id) => nextcloud.ensureBoardFolder(slug, id));
  const ensurePlanCoordinatorImpl = options.ensurePlanCoordinator ?? ensurePlanCoordinator;
  let queue = Promise.resolve();

  function openClawEnv() {
    return {
      HOME: path.dirname(config.openClawRoot),
      USER: process.env.USER || "pw",
      LOGNAME: process.env.LOGNAME || process.env.USER || "pw",
      PATH: [path.dirname(config.openClawBin), "/usr/local/bin", "/usr/bin", "/bin"].join(":"),
      ...(process.env.ITSAPLAN_MCP_BEARER
        ? { ITSAPLAN_MCP_BEARER: process.env.ITSAPLAN_MCP_BEARER }
        : {}),
      ...Object.fromEntries(
        [
          "OPENCLAW_GATEWAY_PASSWORD_FILE",
          "OPENCLAW_GATEWAY_URL",
          "TMPDIR",
          "TMP",
          "TEMP",
        ].flatMap((name) =>
          process.env[name] ? [[name, process.env[name]]] : [],
        ),
      ),
    };
  }

  async function runOpenClaw(args) {
    return execute(config.openClawBin, args, {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
      env: openClawEnv(),
    });
  }

  async function projectWorkspace(project) {
    const slug = projectSlug(project.key);
    const containerPath = `/projects/${slug}`;
    if (project.key === "VERV") {
      const realPath = await existingDirectory(config.verveProjectPath);
      if (
        path.normalize(realPath) !== path.normalize(config.verveProjectPath)
      ) {
        throw new Error(
          "The Verve project path resolves outside its configured directory",
        );
      }
      return { slug, hostPath: realPath, containerPath };
    }

    const root = await ensureDirectory(config.projectsRoot);
    const target = path.resolve(root, slug);
    if (!within(root, target))
      throw new Error("The project workspace path is invalid");
    const hostPath = await ensureDirectory(target);
    if (!within(root, hostPath))
      throw new Error("The project workspace resolves outside its root");
    return { slug, hostPath, containerPath };
  }

  async function openClawAgents() {
    const { stdout } = await runOpenClaw(["agents", "list", "--json"]);
    const parsed = JSON.parse(stdout);
    const list = Array.isArray(parsed) ? parsed : parsed.agents;
    if (!Array.isArray(list))
      throw new Error("OpenClaw returned an invalid agent list");
    return list;
  }

  async function coordinatorPolicyPath(id) {
    const specific = path.join(path.dirname(config.coordinatorPolicyPath), `${id}.json`);
    try {
      await fs.lstat(specific);
      return specific;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return config.coordinatorPolicyPath;
    }
  }

  async function ensureCoordinator(project, projectWorkspace) {
    const id = `${projectWorkspace.slug}-coordinator`;
    const workspace = projectWorkspace.hostPath;
    const agentDir = path.join(config.agentStateRoot, id, "agent");
    let existing = (await openClawAgents()).find((agent) => agent?.id === id);
    if (existing) {
      if (path.normalize(existing.agentDir || "") !== path.normalize(agentDir)) {
        throw new ProvisioningConflictError(
          `OpenClaw agent ${id} exists with a different state directory`,
        );
      }
      if (path.normalize(existing.workspace || "") !== path.normalize(workspace)) {
        const legacyWorkspace = path.join(config.agentWorkspaceRoot, id);
        if (path.normalize(existing.workspace || "") !== path.normalize(legacyWorkspace)) {
          throw new ProvisioningConflictError(
            `OpenClaw agent ${id} exists with an unrelated workspace`,
          );
        }
        await runOpenClaw([
          "config",
          "set",
          `agents.entries.${id}.workspace`,
          JSON.stringify(workspace),
          "--strict-json",
          "--expect-current-json",
          JSON.stringify(existing.workspace),
        ]);
        existing = (await openClawAgents()).find((agent) => agent?.id === id);
      }
    } else {
      await runOpenClaw([
        "agents",
        "add",
        id,
        "--non-interactive",
        "--role",
        "coordinator",
        "--workspace",
        workspace,
        "--agent-dir",
        agentDir,
        "--json",
      ]);
      existing = (await openClawAgents()).find((agent) => agent?.id === id);
      if (
        !existing ||
        path.normalize(existing.workspace || "") !== path.normalize(workspace) ||
        path.normalize(existing.agentDir || "") !== path.normalize(agentDir)
      ) {
        throw new Error("OpenClaw did not confirm the new coordinator");
      }
    }
    if (
      !existing ||
      path.normalize(existing.workspace || "") !== path.normalize(workspace) ||
      path.normalize(existing.agentDir || "") !== path.normalize(agentDir)
    ) {
      throw new Error("OpenClaw did not confirm the coordinator workspace migration");
    }

    const configuredEntries = JSON.parse(
      (await runOpenClaw(["config", "get", "agents.entries", "--json"])).stdout,
    );
    const teamAgentIds = activeTeamAgentIds(configuredEntries);
    const policy = await applyCoordinatorPolicy({
      agentId: id,
      policyPath: await coordinatorPolicyPath(id),
      runOpenClaw,
      additionalAllowAgents: teamAgentIds.filter((agentId) => agentId !== id),
    });
    const teamDelegation = await reconcileTeamDelegation({ runOpenClaw });
    const integrations = {
      internalData: await (options.ensureInternalReadAccess ?? ensureInternalReadAccess)({
        agentId: id,
        runOpenClaw,
        stateDirectory: path.dirname(config.coordinatorPolicyPath),
      }),
      ...(project.key === "KARR"
        ? {
            careerIssueState: await (options.ensureKarrCareerStateAccess ?? ensureKarrCareerStateAccess)({
              agentId: "karriere-job",
              runOpenClaw,
              stateDirectory: path.dirname(config.coordinatorPolicyPath),
            }),
          }
        : {}),
    };
    return { id, workspace, agentDir, policy, teamDelegation, integrations };
  }

  async function ensureBrowser(agentId) {
    const sessionKey = `agent:${agentId}:main`;
    const { stdout: sessionStdout } = await runOpenClaw([
      "gateway",
      "call",
      "sessions.create",
      "--params",
      JSON.stringify({
        key: sessionKey,
        agentId,
        displayName: `${agentId} workspace`,
      }),
      "--json",
    ]);
    const session = JSON.parse(sessionStdout);
    if (session?.key !== sessionKey || typeof session?.sessionId !== "string") {
      throw new Error("OpenClaw did not confirm the project coordinator session");
    }
    const params = {
      sessionKey,
      agentId,
      name: BROWSER_WIDGET_NAME,
      title: "Browser",
      content: {
        kind: "plugin",
        pluginKind: "browser:dashboard",
        props: { url: config.browserStartUrl, profile: config.browserProfile },
      },
      placement: { size: "full" },
    };
    await runOpenClaw([
      "gateway",
      "call",
      "board.widget.put",
      "--params",
      JSON.stringify(params),
      "--json",
    ]);
    const { stdout } = await runOpenClaw([
      "gateway",
      "call",
      "board.get",
      "--params",
      JSON.stringify({ sessionKey }),
      "--json",
    ]);
    const board = JSON.parse(stdout);
    const widget = Array.isArray(board.widgets)
      ? board.widgets.find((item) => item?.name === BROWSER_WIDGET_NAME)
      : null;
    if (
      widget?.pluginKind !== "browser:dashboard" ||
      widget?.props?.url !== config.browserStartUrl ||
      widget?.props?.profile !== config.browserProfile
    ) {
      throw new Error("OpenClaw did not confirm the project browser widget");
    }
    return {
      id: `${sessionKey}/${BROWSER_WIDGET_NAME}`,
      name: BROWSER_WIDGET_NAME,
      sessionKey,
      sessionId: session.sessionId,
      profile: config.browserProfile,
      startUrl: config.browserStartUrl,
      url: browserUrl(config, agentId),
    };
  }

  async function writeRegistry(envelope, workspace, coordinator, planCoordinator, files, browser, terminal) {
    const registryPath = path.join(
      config.registryRoot,
      `${workspace.slug}.json`,
    );
    const current = await readJson(registryPath, null);
    if (current && current.project?.id !== envelope.project.id) {
      throw new ProvisioningConflictError(
        "The project key belongs to another project id",
      );
    }
    const metadata = {
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
              },
            }
          : {}),
        ...(coordinator
          ? {
              coordinator: {
                id: coordinator.id,
                workspace: coordinator.workspace,
                agentDir: coordinator.agentDir,
                policy: coordinator.policy,
                ...(planCoordinator
                  ? {
                      planAgentId: planCoordinator.planAgentId,
                      planAgentUserId: planCoordinator.planAgentUserId,
                      planUsername: planCoordinator.username,
                      organization: planCoordinator.organization,
                    }
                  : {}),
              },
            }
          : {}),
        ...(files
          ? {
              files: {
                path: files.id,
                ...(files.url ? { url: files.url } : {}),
              },
            }
          : {}),
        ...(browser
          ? {
              browser: {
                id: browser.id,
                name: browser.name,
                sessionKey: browser.sessionKey,
                sessionId: browser.sessionId,
                profile: browser.profile,
                startUrl: browser.startUrl,
                ...(browser.url ? { url: browser.url } : {}),
              },
            }
          : {}),
        ...(terminal
          ? {
              terminal: {
                id: terminal.id,
                ...(terminal.url ? { url: terminal.url } : {}),
              },
            }
          : {}),
      },
      updatedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(registryPath, metadata);
    return registryPath;
  }

  async function provisionResources(envelope) {
    const requested = new Set(envelope.requestedResources);
    const needsWorkspace =
      requested.has("workspace") || requested.has("coordinator") || requested.has("browser") || (envelope.boards?.length ?? 0) > 0;
    const workspace = needsWorkspace
      ? await projectWorkspace(envelope.project)
      : {
          slug: projectSlug(envelope.project.key),
          hostPath: "",
          containerPath: `/projects/${projectSlug(envelope.project.key)}`,
        };
    if (needsWorkspace) await ensureProjectGit(workspace);
    const coordinator = requested.has("coordinator") || requested.has("browser")
      ? await ensureCoordinator(envelope.project, workspace)
      : null;
    const planCoordinator = coordinator
      ? await ensurePlanCoordinatorImpl(config, envelope.project, {
          runOpenClaw,
          openClawEnv: openClawEnv(),
        })
      : null;
    if (coordinator) {
      const organizationInstructions = planCoordinator?.organization?.projectInstructions ?? "";
      await writeProjectContext(config, envelope, coordinator, workspace, organizationInstructions);
    }
    const files = requested.has("files") ? await ensureFiles(workspace.slug) : null;
    const browser = requested.has("browser") ? await ensureBrowser(coordinator.id) : null;
    const terminal = requested.has("terminal")
      ? resource(
          "terminal",
          `terminal-project:${workspace.slug}`,
          terminalUrl(config, workspace.slug),
        )
      : null;
    const boardResources = await provisionBoards(config, envelope, workspace, ensureBoardFiles);
    const registryPath = await writeRegistry(
      envelope,
      workspace,
      coordinator,
      planCoordinator,
      files,
      browser,
      terminal,
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
    if (coordinator) {
      resources.push(
        resource(
          "coordinator",
          coordinator.id,
          coordinatorUrl(config, coordinator.id),
        ),
      );
    }
    if (files) resources.push(files);
    if (terminal) resources.push(terminal);
    if (browser) {
      resources.push(resource("session", browser.sessionKey));
      resources.push(resource("browser", browser.id, browser.url));
    }
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
      const provisioned = await provisionResources(envelope);
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
          error instanceof ProvisioningConflictError
            ? "conflict"
            : "provisioning_failed",
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
  };
}
