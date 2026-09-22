import fs from "node:fs/promises";

const PROJECT_FOLDERS = ["Dokumente", "Ergebnisse", "Archiv"];

async function appPassword(filePath) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("The Nextcloud app password file must be a private regular file");
  }
  const password = (await fs.readFile(filePath, "utf8")).replace(/[\r\n]+$/, "");
  if (!password || password.length > 512) {
    throw new Error("The Nextcloud app password file is invalid");
  }
  return password;
}

function filesUrl(config, projectKey) {
  if (!config.filesUrl) return undefined;
  const url = new URL(config.filesUrl);
  url.searchParams.set("dir", `/Projects/${projectKey}`);
  return url.toString();
}

export function createNextcloudClient(config, options = {}) {
  const request = options.fetch ?? fetch;

  async function davRequest(url, method, authorization) {
    const response = await request(url, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: authorization,
        Host: config.nextcloudHost,
        ...(method === "PROPFIND" ? { Depth: "0" } : {}),
      },
    });
    await response.body?.cancel();
    return response.status;
  }

  return {
    async ensureBoardFolder(projectKey, boardId) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(projectKey) || !Number.isSafeInteger(boardId) || boardId < 1) throw new Error("Invalid board folder");
      await this.ensureProjectFolder(projectKey);
      const password = await appPassword(config.nextcloudPasswordFile);
      const authorization = `Basic ${Buffer.from(`${config.nextcloudUser}:${password}`).toString("base64")}`;
      const root = new URL(config.nextcloudInternalUrl);
      const base = `/remote.php/dav/files/${encodeURIComponent(config.nextcloudUser)}/Projects/${encodeURIComponent(projectKey)}`;
      const folders = ["Boards", `Boards/board-${boardId}`, ...PROJECT_FOLDERS.map((name) => `Boards/board-${boardId}/${name}`)];
      for (const folder of folders) {
        const url = new URL(`${base}/${folder.split("/").map(encodeURIComponent).join("/")}`, root);
        const status = await davRequest(url, "MKCOL", authorization);
        if (status !== 201 && status !== 405) throw new Error(`Nextcloud MKCOL failed with HTTP ${status}`);
        if (await davRequest(url, "PROPFIND", authorization) !== 207) throw new Error("Nextcloud board folder could not be verified");
      }
      const id = `/Projects/${projectKey}/Boards/board-${boardId}`;
      const url = config.filesUrl ? new URL(config.filesUrl) : null;
      url?.searchParams.set("dir", id);
      return { kind: `board:${boardId}:files`, id, ...(url ? { url: url.toString() } : {}) };
    },
    async ensureProjectFolder(projectKey) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(projectKey)) {
        throw new Error("The Nextcloud project folder key is invalid");
      }
      const password = await appPassword(config.nextcloudPasswordFile);
      const authorization = `Basic ${Buffer.from(`${config.nextcloudUser}:${password}`).toString("base64")}`;
      const root = new URL(config.nextcloudInternalUrl);
      const davRoot = `/remote.php/dav/files/${encodeURIComponent(config.nextcloudUser)}/Projects`;
      const parent = new URL(davRoot, root);
      const project = new URL(`${davRoot}/${encodeURIComponent(projectKey)}`, root);
      const folders = PROJECT_FOLDERS.map(
        (name) => new URL(`${project.pathname}/${encodeURIComponent(name)}`, root),
      );

      for (const url of [parent, project, ...folders]) {
        const status = await davRequest(url, "MKCOL", authorization);
        if (status !== 201 && status !== 405) {
          throw new Error(`Nextcloud MKCOL failed with HTTP ${status}`);
        }
      }
      for (const url of [project, ...folders]) {
        const verifyStatus = await davRequest(url, "PROPFIND", authorization);
        if (verifyStatus !== 207) {
          throw new Error(`Nextcloud PROPFIND failed with HTTP ${verifyStatus}`);
        }
      }
      return {
        kind: "files",
        id: `/Projects/${projectKey}`,
        ...(config.filesUrl ? { url: filesUrl(config, projectKey) } : {}),
      };
    },
  };
}
