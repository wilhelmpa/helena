import fs from "node:fs/promises";

// The browser gateway's service token (BROWSER_GATEWAY_TOKEN_FILE, a systemd credential in
// the router's unit): the gateway proves itself to Helena with it, and the router reads the
// project browsers' power settings with it (project-browser-power.mjs).

// A secret must be readable by its owner only. systemd's own credential directory is the
// exception: on a native boot it presents LoadCredential files as 0440 (0400 inside a
// container) and guards the directory itself, so group read is fine there.
function secretModeMask(file) {
  const dir = process.env.CREDENTIALS_DIRECTORY;
  return dir && file.startsWith(`${dir}/`) ? 0o037 : 0o077;
}

export async function readGatewayToken(tokenFile = process.env.BROWSER_GATEWAY_TOKEN_FILE) {
  if (!tokenFile) throw new Error("BROWSER_GATEWAY_TOKEN_FILE is not set");
  const stat = await fs.lstat(tokenFile);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & secretModeMask(tokenFile)) !== 0) {
    throw new Error("browser gateway token file has the wrong permissions");
  }
  const token = (await fs.readFile(tokenFile, "utf8")).trim();
  if (token.length < 32) throw new Error("browser gateway token is too short");
  return token;
}
