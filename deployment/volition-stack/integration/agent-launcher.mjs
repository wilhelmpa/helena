import net from "node:net";

// The provisioning side of agent isolation (deployment/volition-stack/isolation): it asks the
// root launcher to create a project's Unix user and give it the project's folders, to remove
// it again, and to write a project's browser state as the browser user. Every request is one
// JSON line; the launcher answers with one frame.

const FRAME_RESULT = 0x15;
const FRAME_ERROR = 0x14;

export class LauncherError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function launcherRequest(socketPath, request, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    let buffered = Buffer.alloc(0);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new LauncherError("timeout", "The agent launcher did not answer")),
      timeoutMs,
    );
    socket.on("connect", () => socket.write(`${JSON.stringify({ v: 1, ...request })}\n`));
    socket.on("error", (error) =>
      finish(new LauncherError("launcher", `The agent launcher is not reachable: ${error.message}`)),
    );
    socket.on("close", () => finish(new LauncherError("launcher", "The agent launcher closed the connection")));
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 5) return;
      const kind = buffered.readUInt8(0);
      const length = buffered.readUInt32BE(1);
      if (buffered.length < 5 + length) return;
      let answer;
      try {
        answer = JSON.parse(buffered.subarray(5, 5 + length).toString("utf8"));
      } catch {
        return finish(new LauncherError("launcher", "The agent launcher answered something unreadable"));
      }
      if (kind === FRAME_RESULT) return finish(null, answer);
      if (kind === FRAME_ERROR) {
        return finish(new LauncherError(answer.error ?? "launcher", answer.message ?? "The launcher refused"));
      }
      finish(new LauncherError("launcher", "The agent launcher answered out of turn"));
    });
  });
}

export function createAgentLauncher(config) {
  const socketPath = config.agentLauncherSocket;
  return {
    enabled: config.agentIsolation === true,
    ensureProjectUser: (slug, profiles = []) =>
      launcherRequest(socketPath, { op: "ensure-project-user", slug, profiles }),
    removeProjectUser: (slug) => launcherRequest(socketPath, { op: "remove-project-user", slug }),
    // What the project's user owns of a removed agent's profile, or of a deleted project,
    // back to the runner, so provisioning can move it into the trash.
    releaseProjectPaths: (slug, { profiles = [], workspace = false } = {}) =>
      launcherRequest(socketPath, { op: "release-project-paths", slug, profiles, workspace }),
    trashArea: (slug, folder, kind, date, eventId) =>
      launcherRequest(socketPath, { op: "trash-area", slug, folder, kind, date, eventId }),
    browserState: (action, slug, projectId, eventId) =>
      launcherRequest(socketPath, {
        op: "browser-state",
        action,
        slug,
        projectId,
        ...(eventId ? { eventId } : {}),
      }),
  };
}
